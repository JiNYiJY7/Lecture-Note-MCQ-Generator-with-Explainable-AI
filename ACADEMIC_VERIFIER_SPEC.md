# 学术验证器（Academic Verifier）规范

## 角色定义

**严格学术验证器（Strict Academic Verifier）**是一个专门用于检查MCQ答案和解释是否**完全由讲义支持**的组件。

---

## 核心规则

### Rule 1: 禁用外部知识
```
❌ 不允许使用
  - 互联网搜索结果
  - 预训练的一般知识
  - 个人经验或常识
  - 教科书或参考资料（除讲义外）

✅ 只允许
  - 讲义中明确出现的文本
  - 讲义中直接表述的概念
  - 讲义中明确的定义
```

### Rule 2: 不依赖预训练知识
```
❌ 不允许
  - "根据我的知识，..."
  - "通常来说，..."
  - "在实际中，..."
  - "学术共识认为..."

✅ 只允许
  - "讲义第2页提到..."
  - "讲义中定义了..."
  - "根据提供的上下文..."
```

### Rule 3: 显式文本支持
```
对于每个声明，必须能够指出讲义中的确切位置：

✅ 支持的例子：
  Question: 什么是RAG?
  Correct Answer: C. 检索增强生成
  Lecture Quote: "RAG（Retrieval-Augmented Generation）是一种结合检索和生成的技术..."
  ✓ 讲义直接定义了RAG

❌ 不支持的例子：
  Question: 什么是RAG?
  Correct Answer: C. 检索增强生成
  Lecture Content: [讲义中没有提到RAG]
  ✗ 声明虽然正确，但未由讲义支持
```

### Rule 4: 解释必须可追踪
```
解释中的每个关键点都必须能回溯到讲义：

✅ 追踪示例：
  学生答案：选择了B
  正确答案：A
  
  解释："您的选择B强调了速度，但讲义第3页明确指出'
  准确性是首要考虑'，因此正确答案是A。"
  
  追踪：
    - "B强调了速度" ← 来自选项B的文本
    - "讲义第3页明确指出'准确性是首要考虑'" ← 直接引文
    - "因此正确答案是A" ← 逻辑推论
  
  ✓ 可完全追踪

❌ 不可追踪示例：
  解释："B是错的，因为在现代机器学习实践中，
  精度通常被认为比速度更重要。"
  
  ✗ "现代机器学习实践" 是外部知识，不是讲义内容
```

---

## 实现方式

### 验证流程（4步）

```
┌──────────────────────────────┐
│ 1. 提取答案声明              │
│    (Answer Claim Extraction) │
└────────────┬─────────────────┘
             ↓
┌──────────────────────────────┐
│ 2. 在讲义中搜索支持证据       │
│    (Evidence Search)         │
└────────────┬─────────────────┘
             ↓
┌──────────────────────────────┐
│ 3. 验证证据充分性            │
│    (Sufficiency Check)       │
└────────────┬─────────────────┘
             ↓
┌──────────────────────────────┐
│ 4. 生成验证报告              │
│    (Verification Report)     │
└──────────────────────────────┘
```

### 实现伪代码

```python
class StrictAcademicVerifier:
    """严格学术验证器"""
    
    def verify_mcq(self, question, correct_answer, lecture_text):
        """
        验证MCQ答案是否由讲义支持
        
        Args:
            question: MCQ题目
            correct_answer: 正确答案（标签 + 文本）
            lecture_text: 讲义内容
        
        Returns:
            VerificationReport: 验证报告
        """
        report = VerificationReport()
        
        # 步骤1：提取关键声明
        claims = self.extract_claims(question, correct_answer)
        report.claims = claims
        
        # 步骤2：对每个声明搜索证据
        for claim in claims:
            evidence = self.search_evidence_in_lecture(claim, lecture_text)
            
            if evidence:
                report.add_supported_claim(claim, evidence)
            else:
                report.add_unsupported_claim(claim)
        
        # 步骤3：检查是否所有关键声明都被支持
        if all(claim.is_supported for claim in report.claims):
            report.status = "FULLY_SUPPORTED"
            report.confidence = 1.0
        elif any(claim.is_supported for claim in report.claims):
            report.status = "PARTIALLY_SUPPORTED"
            report.confidence = sum(1 for c in report.claims if c.is_supported) / len(report.claims)
        else:
            report.status = "NOT_SUPPORTED"
            report.confidence = 0.0
        
        # 步骤4：生成验证报告
        report.generate_summary()
        return report
    
    def search_evidence_in_lecture(self, claim, lecture_text):
        """在讲义中搜索支持证据"""
        
        # 方法1：精确匹配（最严格）
        if claim.exact_phrase in lecture_text:
            return Evidence(
                type="exact_match",
                quote=claim.exact_phrase,
                location=self.find_location(claim.exact_phrase, lecture_text)
            )
        
        # 方法2：关键词匹配（严格）
        keywords = self.extract_keywords(claim)
        matching_sentences = self.find_sentences_with_keywords(keywords, lecture_text)
        
        if matching_sentences:
            best_match = self.rank_matches(claim, matching_sentences)[0]
            return Evidence(
                type="keyword_match",
                quote=best_match,
                location=self.find_location(best_match, lecture_text),
                confidence=best_match.confidence_score
            )
        
        # 方法3：语义相似性（不使用，因为依赖预训练模型）
        # ❌ 避免使用BERT或其他预训练向量化模型
        
        return None  # 没有找到支持证据
    
    def extract_keywords(self, claim):
        """
        从声明中提取关键词
        
        只使用显式关键词，不进行语义扩展
        示例：
          声明："RAG提高了检索准确性"
          关键词：["RAG", "检索", "准确性"]
        """
        pass
    
    def verify_explanation(self, explanation, question, lecture_text):
        """验证解释是否由讲义支持"""
        
        # 逐句验证解释
        sentences = self.split_into_sentences(explanation)
        
        verification_results = []
        
        for sentence in sentences:
            # 1. 检查是否是逻辑推论
            if self.is_logical_inference(sentence):
                verification_results.append({
                    "sentence": sentence,
                    "type": "logical_inference",
                    "supported": True,  # 逻辑推论无需外部支持
                    "reason": "This is a valid logical inference"
                })
                continue
            
            # 2. 检查是否是事实声明
            if self.is_factual_claim(sentence):
                evidence = self.search_evidence_in_lecture(sentence, lecture_text)
                
                if evidence:
                    verification_results.append({
                        "sentence": sentence,
                        "type": "factual_claim",
                        "supported": True,
                        "evidence": evidence,
                        "quote": evidence.quote
                    })
                else:
                    verification_results.append({
                        "sentence": sentence,
                        "type": "factual_claim",
                        "supported": False,
                        "reason": "Not supported by lecture notes"
                    })
        
        # 汇总
        total = len(verification_results)
        supported = sum(1 for r in verification_results if r["supported"])
        
        return {
            "status": "fully_supported" if supported == total else "partially_supported" if supported > 0 else "not_supported",
            "coverage": supported / total if total > 0 else 0,
            "details": verification_results
        }


class VerificationReport:
    """验证报告"""
    
    def __init__(self):
        self.status = None  # FULLY_SUPPORTED / PARTIALLY_SUPPORTED / NOT_SUPPORTED
        self.confidence = 0.0  # 0.0 - 1.0
        self.claims = []
        self.supported_claims = []
        self.unsupported_claims = []
        self.evidence_list = []
    
    def add_supported_claim(self, claim, evidence):
        self.supported_claims.append({
            "claim": claim,
            "evidence": evidence,
            "quote": evidence.quote,
            "location": evidence.location
        })
    
    def add_unsupported_claim(self, claim):
        self.unsupported_claims.append({
            "claim": claim,
            "reason": "Not found in lecture notes"
        })
    
    def generate_summary(self):
        """生成人类可读的总结"""
        
        if self.status == "FULLY_SUPPORTED":
            return f"""
            ✅ 验证通过
            
            这个MCQ答案完全由讲义支持。
            
            支持的声明数：{len(self.supported_claims)}
            
            证据引用：
            {self._format_evidence()}
            """
        
        elif self.status == "PARTIALLY_SUPPORTED":
            return f"""
            ⚠️ 部分支持
            
            {len(self.supported_claims)} 个声明由讲义支持，
            但 {len(self.unsupported_claims)} 个声明未找到支持证据。
            
            ✓ 支持的声明：
            {self._format_supported()}
            
            ✗ 未支持的声明：
            {self._format_unsupported()}
            """
        
        else:  # NOT_SUPPORTED
            return f"""
            ❌ 验证失败
            
            这个MCQ答案未由讲义支持。
            
            未支持的声明：
            {self._format_unsupported()}
            
            建议：请重新审视答案或讲义内容。
            """
    
    def _format_evidence(self):
        result = ""
        for item in self.supported_claims:
            result += f"\n  - 声明：{item['claim']}\n"
            result += f"    引用：\"{item['quote']}\"\n"
            result += f"    位置：{item['location']}\n"
        return result
    
    def _format_supported(self):
        result = ""
        for item in self.supported_claims:
            result += f"  • {item['claim']}\n"
        return result
    
    def _format_unsupported(self):
        result = ""
        for item in self.unsupported_claims:
            result += f"  • {item['claim']} → {item['reason']}\n"
        return result
```

---

## 验证规则详解

### 规则A：精确匹配 (Exact Match)

```
优先级：⭐⭐⭐⭐⭐ 最严格

示例：
  Lecture: "RAG是检索增强生成（Retrieval-Augmented Generation）的缩写。"
  Answer: "RAG代表检索增强生成"
  
  验证：精确匹配 ✅
  置信度：1.0
```

### 规则B：关键词匹配 (Keyword Match)

```
优先级：⭐⭐⭐⭐ 严格

示例：
  Lecture: "检索增强生成技术结合了信息检索系统和神经网络生成模型。"
  Answer: "RAG结合了检索和生成"
  
  验证：关键词匹配（检索、生成） ✅
  置信度：0.85
```

### 规则C：概念匹配 (Concept Match)

```
优先级：⭐⭐⭐ 中等

示例：
  Lecture: "该系统使用向量数据库存储和检索信息。"
  Answer: "系统使用数据库来存储信息"
  
  验证：概念匹配（数据库、存储） ✅
  置信度：0.7
  
  ⚠️ 注意：不要过度推理
```

### 规则D：逻辑推论 (Logical Inference)

```
优先级：⭐⭐⭐ 中等

示例：
  Lecture: "RAG的准确性优于纯生成模型。"
         "纯生成模型容易产生幻觉。"
  Answer: "RAG比容易产生幻觉的模型更可靠"
  
  验证：逻辑推论 ✅
  置信度：0.8
  
  ✓ 允许的推论：
    - AND, OR, NOT 的逻辑组合
    - 因果关系（如果A则B）
    - 比较关系（A比B更X）
  
  ❌ 不允许的推论：
    - 假设和假说
    - 推断未提及的内容
    - 使用外部知识扩展
```

### 规则E：反例 (Counter-Example)

```
❌ 不支持的声明

示例1：外部知识混入
  Lecture: "该方法在测试中准确率为95%。"
  Answer: "这个方法与其他方法相比性能最优"
  ✗ 讲义中没有与其他方法的比较
  ✗ "性能最优"依赖外部知识

示例2：过度推理
  Lecture: "系统使用BERT进行文本编码。"
  Answer: "系统能够理解复杂的语义关系"
  ✗ 虽然BERT可以理解语义，但讲义未明确说明
  ✗ 这是基于预训练知识的推理

示例3：填充内容
  Lecture: "系统包含以下模块：检索模块、生成模块。"
  Answer: "系统是一个完整的端到端解决方案"
  ✗ "完整"和"端到端"是推断，非讲义直述
```

---

## 验证输出格式

### 完整验证报告

```json
{
  "verification_id": "verify_mcq_12345",
  "timestamp": "2026-01-13T10:30:00Z",
  
  "mcq_info": {
    "question_id": 5,
    "question": "哪个是advanced retrieval technique的例子？",
    "correct_answer": "B. Dense Passage Retrieval (DPR)",
    "lecture_id": 3
  },
  
  "verification_result": {
    "status": "FULLY_SUPPORTED",
    "confidence": 0.95,
    "reasoning": "所有关键声明都由讲义直接支持或可从讲义逻辑推导"
  },
  
  "claim_verification": [
    {
      "claim_id": 1,
      "claim": "DPR是advanced retrieval technique",
      "status": "SUPPORTED",
      "evidence_type": "exact_match",
      "evidence_quote": "Dense Passage Retrieval (DPR) 是一种advanced retrieval technique，使用dense vectors进行相似性匹配",
      "location": "页面2，第2段",
      "confidence": 1.0
    },
    {
      "claim_id": 2,
      "claim": "DPR使用dense vectors",
      "status": "SUPPORTED",
      "evidence_type": "keyword_match",
      "evidence_quote": "DPR 依赖于dense vector representations",
      "location": "页面3，第1段",
      "confidence": 0.9
    }
  ],
  
  "explanation_verification": {
    "status": "FULLY_SUPPORTED",
    "coverage": 1.0,
    "sentence_checks": [
      {
        "sentence": "DPR优于TF-IDF因为它使用learned representations",
        "type": "logical_inference",
        "supported": true,
        "reason": "讲义表明DPR使用learned vectors（页面2），TF-IDF是基于统计的（页面1），因此推论成立"
      }
    ]
  },
  
  "overall_assessment": {
    "verdict": "✅ 通过学术验证",
    "trustworthiness": 0.95,
    "recommendation": "可信任的答案和解释，完全由讲义支持"
  },
  
  "notes": [
    "所有声明都可以直接追踪到讲义",
    "没有使用外部知识",
    "逻辑推论有限且合理"
  ]
}
```

### 简化验证报告

```
MCQ验证结果
===========

题目：哪个是advanced retrieval technique的例子？
正确答案：B. Dense Passage Retrieval (DPR)

验证状态：✅ FULLY_SUPPORTED

关键证据：
  1. "Dense Passage Retrieval (DPR) 是一种advanced retrieval technique"
     → 讲义页面2
  
  2. "DPR 使用dense vectors进行相似性匹配"
     → 讲义页面3

整体评级：可信任 (95%)
```

---

## 集成到系统的位置

### 选项1：生成时验证

```python
# app/modules/mcq_generation/service.py

def generate_mcqs_with_llm(lecture_text, num_questions):
    mcqs = generate_raw_mcqs(...)  # 生成原始MCQ
    
    # 验证每个MCQ
    verified_mcqs = []
    for mcq in mcqs:
        verifier = StrictAcademicVerifier()
        report = verifier.verify_mcq(
            question=mcq.stem,
            correct_answer=mcq.correct_answer,
            lecture_text=lecture_text
        )
        
        if report.status == "FULLY_SUPPORTED":
            verified_mcqs.append(mcq)
            mcq.verification_report = report  # 保存报告
        else:
            print(f"⚠️ MCQ {mcq.id} 未通过学术验证，已过滤")
    
    return verified_mcqs
```

### 选项2：解释时验证

```python
# app/modules/xai/service.py

def build_explanation(lecture_text, question_stem, options, correct_label, ...):
    explanation = build_raw_explanation(...)
    
    # 验证解释
    verifier = StrictAcademicVerifier()
    verification = verifier.verify_explanation(
        explanation=explanation,
        question=question_stem,
        lecture_text=lecture_text
    )
    
    # 添加验证信息到响应
    return {
        "reasoning": explanation,
        "verification": verification,
        "trustworthiness": verification["coverage"]
    }
```

### 选项3：教师审核端点

```python
# app/modules/xai/router.py

@router.post("/verify-mcq")
def verify_mcq_academic(payload: VerifyRequest):
    """教师可以手动触发验证"""
    
    question_id = payload.question_id
    db = SessionLocal()
    
    q = mcq_service.get_question_by_id(db, question_id)
    lecture_text = q.lecture.clean_text
    
    verifier = StrictAcademicVerifier()
    report = verifier.verify_mcq(
        question=q.stem,
        correct_answer=f"{q.answer_key.correct_option.label}. {q.answer_key.correct_option.text}",
        lecture_text=lecture_text
    )
    
    return report.generate_summary()
```

---

## 使用场景

### 场景1：教师生成MCQ后的质量检查

```
教师 → 生成MCQ → 系统自动验证 → 显示验证徽章
                               ✅ 学术验证通过
                               ⚠️ 部分支持
                               ❌ 未通过验证
```

### 场景2：学生看到解释时的信任指示

```
学生选择答案 → 获得解释
           + 验证指示："此解释100%由讲义支持" ✅
           或 "此解释包含教师推理" ⚠️
           或 "此解释未完全由讲义支持" ❌
```

### 场景3：教师审核工具

```
教师 → 进入"质量审查"模块
    → 查看所有MCQ的验证报告
    → 可以看到哪些MCQ有问题
    → 可以编辑或删除不合格的MCQ
```

---

## 限制和注意事项

### ⚠️ 该验证器不能做的事

1. **判断讲义的正确性** - 只能检查MCQ是否与讲义一致
2. **评估教学质量** - 只能检查学术支持，不能判断是否是好题目
3. **处理模糊或矛盾的讲义** - 如果讲义本身有问题，验证会显示矛盾
4. **自动改正错误** - 只能报告问题，不能修复

### ✅ 该验证器能做的事

1. ✓ 确保答案由讲义支持
2. ✓ 识别依赖外部知识的声明
3. ✓ 标记过度推理
4. ✓ 提供证据追踪
5. ✓ 生成可信度分数

---

## 总结

| 维度 | 说明 |
|------|------|
| **目标** | 确保MCQ和解释严格基于讲义，避免外部知识混入 |
| **方法** | 逐句验证，查找讲义支持证据 |
| **严格性** | 非常高；优先精确匹配，允许有限推理 |
| **可用性** | 可作为生成、解释或教师审核时的可选组件 |
| **输出** | 结构化验证报告 + 可信度分数 + 证据引用 |

---

**关键理念**：*学术诚实从验证开始。每个声明都应该能回溯到其来源。*
