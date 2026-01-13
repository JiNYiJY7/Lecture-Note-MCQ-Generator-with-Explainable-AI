# Chatbot 完整逻辑流程

## 整体架构图

```
前端 (React/TypeScript)
    ↓
/xai/chat 端点 (FastAPI)
    ↓
ChatManager
    ├─→ [检查是否是"Check Answer"请求] ✓
    │    └─→ 拦截 → explain_mcq_answer_tool (直接返回)
    │
    └─→ [检查是否是普通问题] 
         ├─→ 注入上下文 (从DB获取讲义内容)
         ├─→ 选择Agent (在线/离线)
         ├─→ 运行Agent (ADK Runner)
         └─→ 返回回复 → Router清理 → 前端显示
```

---

## 详细步骤

### **第1步：前端发送消息到后端**

**调用点：** [frontend/src/components/MCQPage.tsx](../../frontend/src/components/MCQPage.tsx)

```typescript
// 用户点击"发送"按钮
const handleSendMessage = async () => {
  const response = await fetch('/api/xai/chat', {
    method: 'POST',
    body: JSON.stringify({
      session_id: String(currentQuestion),  // 例如: "0", "1", "2"
      message: chatInput,                   // 用户输入的问题
      user_id: "student_1",
      use_offline: useOffline,              // 切换在线/离线
    })
  });
  const data = await response.json();
  appendMessageToChat({ id: msgId, text: data.response, sender: "ai" });
};
```

---

### **第2步：FastAPI路由接收请求**

**文件：** [app/modules/xai/router.py](app/modules/xai/router.py#L54-L77)

```python
@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(payload: ChatRequest):
    """
    接收请求格式：
    {
      "session_id": "0",              # 当前问题ID
      "message": "为什么B是错的?",     # 用户问题
      "user_id": "student_1",
      "use_offline": false
    }
    """
    response_text = await chat_manager.send_message(
        session_id=payload.session_id,
        user_msg=payload.message,
        user_id=payload.user_id,
        use_offline=payload.use_offline,
    )
    
    cleaned_response = clean_agent_response(response_text)
    return ChatResponse(response=cleaned_response)
```

---

### **第3步：ChatManager 核心逻辑**

**文件：** [app/modules/xai/chat_manager.py](app/modules/xai/chat_manager.py)

#### **3.1 初始化**
```python
class ChatManager:
    def __init__(self):
        # 创建会话管理器
        self.session_service = InMemorySessionService()
        
        # 创建两个独立的运行器（在线和离线）
        self.online_runner = Runner(agent=online_agent, ...)
        self.offline_runner = Runner(agent=offline_agent, ...)
```

#### **3.2 发送消息的主要逻辑**
```python
async def send_message(self, session_id, user_msg, user_id, use_offline):
```

**步骤3.2.1：选择合适的Agent**
```python
# 根据use_offline标志选择运行器
target_runner = self.offline_runner if use_offline else self.online_runner
target_app_name = "offline" if use_offline else "online"
```

**步骤3.2.2：创建/确保会话存在**
```python
await self.session_service.create_session(
    app_name=target_app_name,
    user_id=user_id,
    session_id=session_id
)
```

**步骤3.2.3：[关键] 检查是否是"Check Answer"请求**

```python
is_tool_prompt = "explain_mcq_answer_tool" in user_msg
is_manual_check = "question id is" in user_msg.lower()

if is_tool_prompt or is_manual_check:
    # 📨 这是一个"检查答案"请求！
    
    # 用正则表达式提取Question ID
    qid_match = re.search(r"question ID is[:\s]*(\d+)", user_msg, re.IGNORECASE)
    
    # 用正则表达式提取选项标签(A-D)
    label_match = re.search(
        r"(?:option|answer|choice|selected|student|value)[\s:\"'-]*([A-D])\b",
        user_msg,
        re.IGNORECASE
    )
    
    if qid_match:
        qid = int(qid_match.group(1))
        label = label_match.group(1).upper() if label_match else "A"
        
        # 🛡️ 直接调用解释工具，不走Agent流程
        return explain_mcq_answer_tool(
            question_id=qid,
            student_answer_label=label,
            use_offline=use_offline
        )
```

**这是快速路径！绕过Agent，直接返回答案解释。**

**步骤3.2.4：[非Check Answer] 准备讲义上下文**

```python
# 如果session_id是数字，从数据库获取对应问题的讲义内容
context_block = ""
if session_id.isdigit():
    db = SessionLocal()
    q = mcq_service.get_question_by_id(db, int(session_id))
    
    if q and q.lecture and q.lecture.clean_text:
        # 只取前2000字符（防止过长）
        text_content = q.lecture.clean_text[:2000]
        context_block = f"CONTEXT FROM LECTURE:\n\"\"\"\n{text_content}\n\"\"\"\n\n"
    db.close()

# 将上下文和用户问题合并
full_prompt = f"{context_block}USER QUESTION:\n{user_msg}"
```

**步骤3.2.5：使用Agent运行聊天**

```python
# 创建用户消息对象
content = types.Content(role="user", parts=[types.Part(text=full_prompt)])

# 运行Agent（这会调用LLM，可能会调用工具）
async for event in target_runner.run_async(
    user_id=user_id,
    session_id=session_id,
    new_message=content
):
    # 等待Agent返回最终响应
    if event.is_final_response() and event.content:
        final_text = event.content.parts[0].text or ""

return final_text
```

---

### **第4步：Agent 处理请求**

**文件：** [app/mcq_chatbot/agent.py](app/mcq_chatbot/agent.py)

#### **4.1 Agent的两种模式**

**模式A：在线Agent (DeepSeek)**
```python
online_agent = Agent(
    name="LN_MCQ_Chatbot_Online",
    model=LiteLlm(model="deepseek/deepseek-chat", timeout=120),
    instruction=online_instruction,
    tools=[
        explain_mcq_answer_tool,  # 真实工具
        get_status,               # 演示工具
        set_verbosity,
        load_lecture_text,
        highlight_key_points,
        generate_mcq,
        topic_review,
    ]
)
```

**模式B：离线Agent (Ollama Llama 3.2)**
```python
offline_agent = Agent(
    name="AI_Tutor",
    model=LiteLlm(
        model="ollama/llama3.2:1b",
        timeout=120,
        api_base="http://localhost:11434"  # 强制本地
    ),
    instruction=offline_instruction,
    tools=[]  # ⚠️ 离线Agent没有工具
)
```

#### **4.2 Agent的指令(Prompt)**

**在线Agent的指令：**
```
You are an AI Tutor inside an MCQ system.

CRITICAL RULES:
1) Never mention tools, function calls, tool names, parameters, schemas, or any internal limitations.
2) Never output meta text such as:
   - 'I understand you want me to use ...'
   - 'the tool requires ...'
   - 'I cannot modify the tool output format'
   - 'Would you like me to proceed?'

WHEN THE USER IS CHECKING AN ANSWER:
- If BOTH a Question ID and a selected option label (A-D) are present, call:
  explain_mcq_answer_tool(question_id, student_answer_label)
- Output ONLY the final result to the user. No additional commentary.
- If either Question ID or option label is missing, ask ONE short question:
  'Please provide the Question ID and your selected option (A, B, C, or D).'

FOR OTHER QUESTIONS:
- Be concise and helpful (<= 50 words).
- Use lecture context when available; if missing, use general knowledge.
```

**离线Agent的指令：**
```
You are a helpful, concise AI Tutor.
Answer the user's questions clearly using the provided lecture context.
Keep your answers short (under 50 words) and direct.
Do not mention tools or technical details.
Do not state your name.
```

#### **4.3 Agent的决策流程**

```
Agent 收到 full_prompt (包含讲义上下文 + 用户问题)
    ↓
LLM 读取指令和提示
    ↓
[决策] 是否需要调用工具?
    ├─→ YES: 调用 explain_mcq_answer_tool()
    │        (仅在线Agent有这个权限)
    │
    └─→ NO: 直接生成回复

生成回复 → 返回给 ChatManager
```

---

### **第5步：工具调用（如果触发）**

**文件：** [app/modules/xai/agent_tools.py](app/modules/xai/agent_tools.py#L89-188)

#### **5.1 工具签名**
```python
def explain_mcq_answer_tool(
    question_id: int,
    student_answer_label: str,
    use_offline: bool = False
) -> str:
```

#### **5.2 工具的核心逻辑**

```python
# ⏱️ 第1步：从数据库加载问题
q = mcq_service.get_question_by_id(db, question_id)

# 🔍 第2步：符号化检查答案是否正确
student_label = _normalize_choice_label(student_answer_label)  # 规范化为 A/B/C/D
correct_label = _normalize_choice_label(q.answer_key.correct_option.label)
is_correct = (student_label == correct_label)

# 💾 第3步：检查缓存
existing = db.query(Explanation).filter(
    question_id == question_id,
    option_id == selected_option_id,
    source == "ai_generated_v2"
).first()

if existing:
    print(f"⚡ Found cached explanation")
    return existing.content

# 🤖 第4步：如果没有缓存，调用LLM生成解释
ai_explanation = _generate_ai_explanation(
    lecture_text=q.lecture.clean_text,
    question_stem=q.stem,
    student_text=student_text,
    correct_text=correct_text,
    is_correct=is_correct,
    use_offline=use_offline
)

# 💾 第5步：保存到缓存
new_expl = Explanation(
    question_id=question_id,
    option_id=selected_option_id,
    content=ai_explanation,
    source="ai_generated_v2"
)
db.add(new_expl)
db.commit()

return ai_explanation
```

#### **5.3 LLM生成解释的逻辑**

```python
def _generate_ai_explanation(
    lecture_text, question_stem, student_text, 
    correct_text, is_correct, use_offline
):
    # 分支1: 如果正确
    if is_correct:
        prompt = f"""
        CONTEXT: {lecture_text[:1500]}
        QUESTION: {question_stem}
        ANSWER: {student_text}
        
        TASK: Explain why this answer is CORRECT based on the context.
        FORMAT: Start with "Correct - ". Keep it strictly under 2 sentences.
        """
    
    # 分支2: 如果错误（⚠️ 不显示正确答案，强制AI进行推理）
    else:
        prompt = f"""
        CONTEXT: {lecture_text[:1500]}
        QUESTION: {question_stem}
        STUDENT WRONG CHOICE: {student_text}
        
        TASK: Explain why the STUDENT CHOICE is INCORRECT based on the context.
        - Point out the error in the student's choice.
        - Do NOT mention the correct answer key.
        
        FORMAT: Start with "Incorrect - ". Keep it strictly under 2 sentences.
        """
    
    # 调用LLM（在线或离线）
    if use_offline:
        response = completion(
            model="ollama/llama3.2:1b",
            messages=[{"role": "user", "content": prompt}],
            api_base="http://localhost:11434",
            timeout=60
        )
    else:
        response = call_deepseek_chat("You are a tutor.", prompt)
    
    return response.strip()
```

---

### **第6步：返回给前端**

**路由清理响应：**
```python
def clean_agent_response(agent_text: str) -> str:
    """确保响应格式正确"""
    if not agent_text or not agent_text.strip():
        return "No response from AI Tutor."
    
    text = agent_text.strip()
    
    # 如果已经是"Correct."或"Incorrect."格式，直接返回
    if text.startswith("Correct.") or text.startswith("Incorrect."):
        return text
    
    # 旧格式转换 "Correct - " → "Correct. "
    if text.startswith("Correct - "):
        return "Correct. " + text[len("Correct - "):].strip()
    if text.startswith("Incorrect - "):
        return "Incorrect. " + text[len("Incorrect - "):].strip()
    
    # 防止过长（限制2000字符）
    return text[:2000]
```

**返回给前端：**
```python
return ChatResponse(response=cleaned_response)
```

**前端显示：**
```typescript
// MCQPage.tsx
const appendMessageToChat = (msg: ChatMessage) => {
  const key = getQuestionKey(currentQuestion);
  setChatsByQuestion((prev) => ({
    ...prev,
    [key]: [...(prev[key] || []), msg],
  }));
};

// 消息会显示在AI Tutor框中，自动格式化（加粗、列表等）
```

---

## 两条主要路径总结

### **路径A: Check Answer（快速路径）**

```
用户点击"Check Answer"
    ↓
前端发送: "question ID is X, Selected: Y"
    ↓
ChatManager 检测到"Check Answer"关键词
    ↓
正则提取 Question ID 和选项标签
    ↓
直接调用 explain_mcq_answer_tool()
    ↓
[工具内部]
  - 符号化检查是否正确
  - 检查缓存
  - 如果需要，调用LLM生成解释
  - 保存到缓存
    ↓
立即返回解释（不经过Agent）
    ↓
前端显示
```

**特点：** ⚡ 快速、跳过Agent、直接到工具

---

### **路径B: General Question（正常路径）**

```
用户点击"Ask follow-up..."并提问
    ↓
前端发送普通消息: "为什么B是错的?"
    ↓
ChatManager 检查不是"Check Answer"
    ↓
从数据库获取讲义上下文
    ↓
选择Agent (在线/离线)
    ↓
创建会话 → 运行Agent
    ↓
Agent [使用LLM]
  - 读取指令 + 讲义上下文 + 用户问题
  - LLM 决定是否需要工具
  - 如果需要，调用工具
  - 生成回复
    ↓
等待Agent返回最终响应
    ↓
清理格式 → 返回给前端
    ↓
前端显示
```

**特点：** 正常、经过Agent、可能调用工具、可能直接回答

---

## 关键设计特点

| 特点 | 说明 |
|------|------|
| **双重检查** | Chat Manager 和 Agent 都可以检测"Check Answer"，但Manager的检测更快 |
| **缓存机制** | 同一问题的解释被缓存，避免重复调用LLM |
| **上下文注入** | 自动从数据库获取讲义内容并注入提示 |
| **在线/离线切换** | 用户可以随时切换，系统使用不同的Agent和模型 |
| **工具拦截** | 如果检测到"Check Answer"，ChatManager直接调用工具，跳过Agent |
| **指令硬化** | Agent的指令明确禁止提及工具细节，防止信息泄露 |
| **多轮对话** | 使用ADK的会话管理，同一session可以保持对话历史 |

---

## 总流程图（ASCII）

```
┌─────────────────────────────────────────────────────────────┐
│                     前端 (React)                             │
│  用户输入 → Check Answer?                                   │
│              ├─ YES → 发送"question ID is X, selected Y"  │
│              └─ NO  → 发送普通问题                         │
└───────────────────────┬─────────────────────────────────────┘
                        ↓
                 /api/xai/chat (FastAPI)
                        ↓
              ┌─────────────────────┐
              │  ChatManager        │
              │  send_message()     │
              └────────┬────────────┘
                       ↓
            [是 "Check Answer"?]
              ↙            ↘
            YES             NO
             │               │
             ↓               ↓
    直接调用工具      准备讲义上下文
    explain_*         + 选择Agent
    answer_tool()     (在线/离线)
             │               │
             ↓               ↓
         [工具逻辑]      [Agent逻辑]
    - 检查答案         - 读取指令
    - 检查缓存         - 调用LLM
    - 生成解释         - [可能] 调用工具
    - 保存缓存         - 生成回复
             │               │
             └───────┬───────┘
                     ↓
              返回响应文本
                     ↓
           clean_agent_response()
                     ↓
            返回给前端并显示
```

---

## 总结

**ChatBot = 路由 + 拦截 + 上下文注入 + Agent运行**

1. **路由层：** ChatManager根据消息类型决定路径（快速路径 vs 正常路径）
2. **拦截层：** 检测"Check Answer"并直接调用工具（跳过Agent）
3. **上下文层：** 自动从DB注入讲义内容到提示
4. **执行层：** Agent（LLM + 工具）或工具直接执行

整个系统围绕两个核心问题设计：
- ❓ **这是"Check Answer"吗？** → 快速路径（工具直接）
- ❓ **这是普通问题吗？** → 正常路径（Agent处理）
