# Lecture Note MCQ Generator with Explainable AI
## Comprehensive AI/ML Technical Analysis

---

## EXECUTIVE SUMMARY

This is a **modular educational software system** that integrates three distinct AI/ML components for automated Multiple-Choice Question (MCQ) generation and explainable answer evaluation. The system exhibits a **hybrid architecture** combining LLM-based generation, rule-based reasoning, and classical information retrieval—but does NOT implement true Retrieval-Augmented Generation (RAG) in the conventional sense. The system is **NOT built using Google ADK patterns**, despite importing ADK libraries for agent orchestration.

---

## 1. SYSTEM ARCHITECTURE ANALYSIS

### 1.1 High-Level Module Structure

```
├── app/
│   ├── core/               # LLM client abstraction + database setup
│   ├── modules/
│   │   ├── document_processing/    # PDF/text ingestion (zero AI)
│   │   ├── mcq_generation/         # LLM-based MCQ synthesis (DeepSeek)
│   │   ├── mcq_management/         # Data persistence layer
│   │   └── xai/                    # Explainable AI (rule-based + TF-IDF)
│   └── mcq_chatbot/                # ADK Agent integration (routing only)
├── frontend/               # React UI (no ML logic)
└── requirements.txt        # Python dependencies
```

### 1.2 Execution Flow

1. **Document Processing** → Text extraction from PDF/TXT (regex-based whitespace normalization, no NLP)
2. **MCQ Generation** → LLM prompt engineering with difficulty guidance
3. **MCQ Storage** → SQLAlchemy persistence
4. **Answer Checking** → Symbolic label matching (no prediction)
5. **XAI Explanation** → Rule-based reasoning + optional TF-IDF evidence retrieval
6. **Agent Routing** → ADK framework for chat interface (orchestration layer only)

---

## 2. DETECTED AI/ML/NLP TECHNIQUES

### 2.1 LLM-Based Generation (DeepSeek + Ollama)

**Technique Name:** Prompt Engineering with Instruction-Following

**Implementation:**
- File: `app/modules/mcq_generation/service.py` (lines 214–280)
- Uses `litellm.completion()` to call either:
  - **Online Mode:** DeepSeek Chat API (`deepseek/deepseek-chat`)
  - **Offline Mode:** Ollama local model (`ollama/llama3.2:1b`)
- System prompt: "You are an expert university MCQ writer..."
- User prompt includes lecture text + difficulty guidelines + JSON schema
- Response parsing via `_extract_json_block()` to handle markdown fences

**Purpose:**
Generate diverse, contextually relevant MCQs with specified difficulty levels from unstructured lecture notes.

**Classification:** **LLM-Based AI** (Large Language Model with prompt engineering)

**Key Evidence:**
```python
def generate_mcqs_with_llm(lecture_text, num_questions, difficulty):
    system_prompt = "You are an expert university MCQ writer..."
    user_prompt = (
        f"Lecture text:\n{lecture_text}\n\n"
        + (f"{guidelines}\n" if guidelines else "")
        + f"Generate EXACTLY {k} high-quality MCQs..."
    )
    raw = call_deepseek_chat(system_prompt, user_prompt)
```

---

### 2.2 Difficulty Classification (Rule-Based Inference)

**Technique Name:** Symbolic Pattern Matching for Task Classification

**Implementation:**
- File: `app/modules/mcq_generation/service.py` (lines 75–130)
- Function `infer_difficulty()` uses linguistic heuristics:
  - **Easy:** Starts with "What is", "Define", direct recall patterns
  - **Medium:** Contains "Difference", "Purpose", "Relationship", "Why"
  - **Hard:** Contains "Calculate", "Derive", "NOT", "EXCEPT", multi-step cues

**Purpose:**
Classify question difficulty without ML training; provide guidance hints to the LLM for consistent MCQ generation.

**Classification:** **Rule-Based AI** (pattern matching, no learned parameters)

**Key Evidence:**
```python
def infer_difficulty(stem):
    easy_starts = ("what is", "define", "stands for", "what type")
    if s.startswith(easy_starts) and "not" not in s: return "easy"
    
    hard_cues = ("calculate", "compute", "NOT", "EXCEPT")
    if any(w in s for w in hard_cues): return "hard"
    
    return "medium"
```

---

### 2.3 TF-IDF Based Evidence Retrieval

**Technique Name:** Vector Space Information Retrieval (Bag-of-Words with TF-IDF Weighting)

**Implementation:**
- File: `app/modules/xai/service.py` (lines 149–179)
- Uses `sklearn.feature_extraction.text.TfidfVectorizer`
- Process:
  1. Split lecture text into sentences (regex-based splitting on `[.!?]`)
  2. Fit TF-IDF matrix over corpus = [sentences] + [query]
  3. Compute cosine similarity between query and each sentence
  4. Return top-3 sentences with similarity > 0.1

**Purpose:**
Retrieve lecture evidence to support/validate XAI explanations (optional feature).

**Classification:** **Statistical ML / Classical IR** (TF-IDF is a statistical weighting scheme, not deep learning)

**Key Evidence:**
```python
def retrieve_evidence(lecture_text, query, top_k=3):
    sentences = re.split(r"(?<=[.!?])\s+", lecture_text)
    vectorizer = TfidfVectorizer(stop_words="english")
    tfidf_matrix = vectorizer.fit_transform(corpus)  # corpus = sentences + [query]
    cosine_similarities = (tfidf_matrix[-1] * tfidf_matrix[:-1].T).toarray()[0]
    top_indices = cosine_similarities.argsort()[-top_k:][::-1]
    return [sentences[idx] for idx in top_indices if cosine_similarities[idx] > 0.1]
```

---

### 2.4 Explanation Generation (Rule-Based Pedagogical Logic)

**Technique Name:** Template-Based Reasoning with Semantic Analysis

**Implementation:**
- File: `app/modules/xai/service.py` (lines 182–317)
- Function `build_explanation()`:
  1. **Question Classification:** `_question_kind()` categorizes stem as definition/purpose/effect/advantage/comparison
  2. **Keyword Overlap Analysis:** `_top_overlaps()` extracts common keywords between question and options
  3. **Correctness Verdict:** "Correct/Incorrect. The correct answer is X."
  4. **Reasoning Logic:** Constructs 2–4 full sentences based on:
     - Question type (e.g., "This question asks for the definition...")
     - Semantic keyword matching (shared terms between stem and correct option)
     - Distractor identification (wrong option used different keywords)
  5. **Evidence Injection:** Optionally appends TF-IDF-retrieved sentences if `include_evidence=True`

**Purpose:**
Provide pedagogically sound, transparent explanations that teach students *why* they were correct/incorrect.

**Classification:** **Rule-Based AI with Semantic Heuristics** (deterministic logic based on linguistic patterns, no trained model)

**Key Evidence:**
```python
def build_explanation(lecture_text, question_stem, options, correct_label, student_label):
    kind = _question_kind(question_stem)  # Classify by stem pattern
    q_vs_correct = _top_overlaps(question_stem, correct_text, top_k=6)  # Keyword overlap
    
    if kind == "definition":
        s2 = "This question is asking for the correct definition..."
    elif kind == "purpose":
        s2 = "This question is asking what the concept is used for..."
    
    if is_correct:
        sentences.append(f'Your choice matches the stem keywords ({q_vs_correct}), which aligns with...')
    else:
        sentences.append(f'Your option emphasizes {q_vs_student}, but the stem points to {q_vs_correct}...')
```

---

### 2.5 Offline LLM with Cached Explanations

**Technique Name:** Answer Correctness Verification + Caching with Model Fallback

**Implementation:**
- File: `app/modules/xai/agent_tools.py` (lines 89–188)
- Function `explain_mcq_answer_tool()`:
  1. **Correctness Verification:** Symbolic comparison of student label with stored correct label
  2. **Conditional AI Generation:**
     - If correct: "Explain why this answer is CORRECT"
     - If incorrect: "Explain why this answer is INCORRECT" (note: does NOT reveal correct answer to force reasoning)
  3. **Caching Strategy:** 
     - Before generation, check DB for existing explanation with version tag `CACHE_VERSION`
     - After generation, save to DB with version tag (invalidates old cached explanations on schema changes)
  4. **Model Switching:** User-controlled via `use_offline` flag:
     - True → Ollama local (`llama3.2:1b`)
     - False → DeepSeek online

**Purpose:**
Generate context-specific explanations for student answers; reduce API calls via caching; enable offline operation.

**Classification:** **LLM-Based AI with Deterministic Logic** (LLM generates text, but correctness verdict is symbolic)

**Key Evidence:**
```python
def explain_mcq_answer_tool(question_id, student_answer_label, use_offline):
    # 1. Fetch question
    q = mcq_service.get_question_by_id(db, question_id)
    
    # 2. Symbolic correctness check
    student_label = _normalize_choice_label(student_answer_label)
    correct_label = _normalize_choice_label(q.answer_key.correct_option.label)
    is_correct = (student_label == correct_label)
    
    # 3. Check cache
    existing = db.query(Explanation).filter(
        question_id == question_id,
        option_id == selected_option_id,
        source == CACHE_VERSION
    ).first()
    if existing: return existing.content
    
    # 4. Generate if not cached
    ai_explanation = _generate_ai_explanation(..., is_correct, use_offline)
    
    # 5. Save to cache
    new_expl = Explanation(question_id, option_id, content, source=CACHE_VERSION)
    db.add(new_expl); db.commit()
```

---

### 2.6 Natural Language Processing (Minimal)

**Technique Name:** Regex-Based Tokenization and Stopword Filtering

**Implementation:**
- File: `app/modules/xai/service.py` (lines 99–135)
- `_tokenize_keywords()`: Extracts tokens via regex `[A-Za-z][A-Za-z\-']+`, removes stopwords
- `_top_overlaps()`: Computes set intersection of keywords between two texts
- `_short_quote()`: Truncates text to 140 chars with ellipsis

**Purpose:**
Extract semantic keywords for explanation reasoning; support keyword-overlap analysis.

**Classification:** **Classical NLP / Rule-Based Text Processing** (no neural networks, pure regex + sets)

---

## 3. RAG ANALYSIS: Is this true RAG?

### 3.1 What is Retrieval-Augmented Generation (RAG)?

**Classic RAG Pipeline:**
1. Query → Retrieve relevant documents/chunks from external corpus
2. Rank/filter retrieved items
3. Augment LLM prompt with retrieved context
4. LLM generates response conditioned on retrieved context

### 3.2 What This System Implements

| Component | Implemented? | Notes |
|-----------|:----------:|---------|
| **Retrieval** | ✓ Partial | TF-IDF retrieves sentences from lecture text, but only for XAI explanations |
| **Augmentation** | ✗ No | MCQ generation does NOT use retrieval; LLM receives full lecture text directly in the prompt |
| **Generation** | ✓ Yes | LLM generates MCQs; LLM generates explanations |
| **Ranking/Validation** | ✗ Minimal | Evidence retrieved via cosine similarity threshold (0.1), but no ranking re-scoring |

### 3.3 Classification

**This is NOT traditional RAG.**

**Why?**
- MCQ generation uses **in-context learning** (full text in prompt), not retrieval + ranking
- XAI explanation builds explanations **primarily from rule-based logic**, not from retrieved context
- Retrieved evidence is **optional and auxiliary** (only when `include_evidence=True`)

**What it is instead:**
- **In-Context Learning with Optional Evidence Retrieval**
- MCQ generation: prompt engineering with full lecture context
- XAI: rule-based explanation + optional TF-IDF supporting evidence

### 3.4 Correctness Validation: Is there validation logic?

**Yes, but rule-based, not learned:**
- Correctness verdict is **symbolic**: student label == stored correct label (exact string match)
- Explanation varies based on **heuristic question classification** (definition vs. purpose vs. effect)
- Keyword matching is **deterministic**: set intersection of tokens

**No learned validation:** This system does not have a fine-tuned classifier that learns to validate retrieved documents or generated MCQs.

---

## 4. GOOGLE ADK ANALYSIS: Is this truly ADK-based?

### 4.1 What Google ADK Provides

**ADK Components Used:**
```python
from google.adk.agents import Agent
from google.adk.apps import App
from google.adk.models.lite_llm import LiteLlm
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
```

### 4.2 What This System Implements

| ADK Feature | Used? | Details |
|-------------|:-----:|----------|
| **Agent Definition** | ✓ Yes | `Agent` class instantiated with model, instruction, tools |
| **Tool Registration** | ✓ Yes | `explain_mcq_answer_tool` registered in agent's tool list |
| **App Wrapper** | ✓ Yes | `App` class wraps agent for deployment |
| **Session Management** | ✓ Yes | `InMemorySessionService` for multi-turn chat |
| **Runner/Executor** | ✓ Yes | `Runner` executes agent within a session |
| **Routing/Orchestration** | ✗ No | No dynamic routing between agents based on intent |
| **Planner–Executor** | ✗ No | No explicit planning; direct tool invocation |
| **Agent Hierarchy** | ✗ No | No master agent coordinating sub-agents |
| **Goal-Driven Decomposition** | ✗ No | No automatic task breakdown by agent |

### 4.3 ADK Usage Pattern

```python
# app/mcq_chatbot/agent.py
online_agent = Agent(
    name="LN_MCQ_Chatbot_Online",
    model=LiteLlm(model=ONLINE_MODEL, timeout=120),
    instruction=online_instruction,
    tools=[...explain_mcq_answer_tool, ...],
)

# app/modules/xai/chat_manager.py
class ChatManager:
    def __init__(self):
        self.online_runner = Runner(agent=online_agent, ...)
        self.offline_runner = Runner(agent=offline_agent, ...)
    
    async def send_message(self, session_id, user_msg, use_offline):
        target_runner = self.offline_runner if use_offline else self.online_runner
        # Direct tool invocation via regex pattern matching, not ADK's automatic routing
```

### 4.4 Classification: Does it align with ADK philosophy?

**Partially.**

**What aligns with ADK:**
- ✓ Tool registration and invocation
- ✓ Agent instruction definition
- ✓ Multi-turn session management
- ✓ Model abstraction (LiteLlm)

**What does NOT align with ADK:**
- ✗ **Manual mode switching** (not automatic intent routing): `if use_offline: use offline_runner else: use online_runner`
- ✗ **Manual tool selection**: System manually detects "Check Answer" via regex in `chat_manager.py` line 45–46, rather than letting ADK's tool-calling mechanism decide
- ✗ **No ADK-style orchestration**: ADK enables agents to coordinate; this system has two independent agents with explicit user selection
- ✗ **Tool invocation is hardcoded**: Chat manager manually calls `explain_mcq_answer_tool()` instead of letting ADK's planner invoke it

**Conclusion:** The system uses ADK's **infrastructure** (Agent, Tool, Runner, Session) but not its **reasoning patterns** (automatic tool selection, plan generation, agent coordination).

---

## 5. DETAILED TECHNIQUE CLASSIFICATION TABLE

| Technique | Classification | Location | Purpose | Learned? |
|-----------|:---------------:|----------|---------|:--------:|
| Prompt Engineering | LLM-Based AI | `mcq_generation/service.py` | Generate MCQs | No |
| Difficulty Inference | Rule-Based AI | `mcq_generation/service.py` | Classify question difficulty | No |
| TF-IDF Retrieval | Classical ML | `xai/service.py` | Retrieve supporting evidence | No |
| Semantic Keyword Overlap | Rule-Based / NLP | `xai/service.py` | Explain correctness via keywords | No |
| Explanation Reasoning | Rule-Based AI | `xai/service.py` | Generate pedagogical explanations | No |
| Correctness Verification | Symbolic Logic | `xai/agent_tools.py` | Check student answer | N/A |
| LLM Caching | System Design | `xai/agent_tools.py` | Reduce API calls | N/A |
| ADK Agent Routing | Orchestration | `mcq_chatbot/agent.py` | Route to online/offline | No |

---

## 6. AI CONTRIBUTION LEVEL ASSESSMENT

### 6.1 Strengths

✅ **Multiple AI modalities:**
   - LLM for generation (DeepSeek/Ollama)
   - Classical NLP for explanation (keyword analysis)
   - Statistical ML for evidence retrieval (TF-IDF)

✅ **Educational rigor:**
   - Difficulty-guided MCQ generation (not just random)
   - Full-sentence explanations (not bullet points or templates)
   - Pedagogical reasoning (explains what question tests, not just verdict)

✅ **Explainability:**
   - All explanations are transparent (rule-based, interpretable)
   - No black-box neural networks in critical path

✅ **Robustness:**
   - Fallback to offline model if online fails
   - Caching to reduce API failures
   - Validated JSON parsing

### 6.2 Limitations

❌ **Not true Retrieval-Augmented Generation (RAG):**
   - MCQ generation ignores the retrieval component
   - Retrieval is auxiliary, not central

❌ **No learned validation:**
   - Correctness is symbolic, not predictive
   - No fine-tuned classifier for answer correctness

❌ **Not truly agent-driven:**
   - ADK framework used for infrastructure, not reasoning
   - Manual mode selection (online/offline), not automatic

❌ **Limited semantic understanding:**
   - Keyword overlap is surface-level (bag-of-words)
   - No deep contextual reasoning about question quality

❌ **No curriculum learning:**
   - Difficulty inference is rule-based, not adaptive
   - No learning from student performance

### 6.3 Overall Assessment

**AI Contribution Level: MODERATE**

**Justification:**
- ✓ Integrates multiple AI techniques (LLM, statistical ML, rule-based)
- ✓ Demonstrates educational AI domain knowledge (MCQ pedagogy, difficulty scaling)
- ✗ Lacks sophisticated ML (no learned models, no neural ranking, no reinforcement learning)
- ✗ Does not implement true RAG or advanced agent orchestration
- ✓ Code is clean, modular, explainable (good for final year project)

**For FYP Context:**
This is a **solid undergraduate project** with:
- Clear problem definition (MCQ generation from lectures)
- Multi-component integration (LLM + classical NLP + retrieval)
- Pedagogical grounding (explainability, difficulty scaling)
- Production-ready features (caching, offline fallback)

But it is **not a research contribution** in AI because:
- No novel ML algorithms
- No evaluation of generation quality
- No comparative study vs. baselines
- Heavy reliance on existing LLM (DeepSeek) and libraries (scikit-learn, ADK)

---

## 7. TECHNIQUES EXPLICITLY NOT USED

| Technique | Why Not Used | Impact |
|-----------|:-------------:|--------|
| **Fine-tuned LLM** | MCQ generation uses prompt engineering on pre-trained DeepSeek; no custom training | Reduces data requirements but limits quality customization |
| **Semantic Search (BERT embeddings)** | System uses TF-IDF instead of learned embeddings | Faster but less contextually aware |
| **Named Entity Recognition (NER)** | Could extract key concepts from lecture; not implemented | Explanations use bag-of-words keyword matching |
| **Reinforcement Learning** | Could optimize difficulty calibration per student; not implemented | System uses static rules |
| **Neural Ranking / Learning-to-Rank** | Could re-rank retrieved evidence; not implemented | Evidence ranking relies on TF-IDF threshold |
| **Multi-Agent Collaboration** | ADK supports it; system uses two independent agents with manual switching | Simpler but less flexible orchestration |
| **Knowledge Graph** | Could store semantic relationships between concepts; not used | Limits concept-level reasoning |
| **Question Quality Scoring** | Could predict if MCQ is well-formed; not implemented | No automatic quality control |

---

## 8. ACADEMIC SUMMARY FOR VIVA/DEFENCE

### For Final Year Project (FYP) Presentation:

**Title:** "Automated MCQ Generation and Explainable Answer Evaluation from Lecture Notes Using Large Language Models and Rule-Based Reasoning"

**Problem Statement:**
Manual MCQ creation is time-consuming and inconsistent. Lecturers need an automated tool that:
1. Generates diverse, difficulty-calibrated MCQs from lecture notes
2. Provides transparent explanations for student answers
3. Works both online (DeepSeek API) and offline (Ollama)

**Methodology:**
- **MCQ Generation:** Prompt engineering with DeepSeek/Ollama, rule-based difficulty classification
- **XAI Explanation:** Symbolic correctness verification + rule-based pedagogical reasoning + optional TF-IDF evidence retrieval
- **Architecture:** Modular FastAPI backend + React frontend with ADK-based agent routing

**Key Technical Contributions:**
1. **Integrated difficulty guidance** into MCQ generation prompt (not just raw generation)
2. **Pedagogical explanation generation** that teaches *why* an answer is correct/incorrect
3. **Dual-mode operation** (online DeepSeek / offline Ollama) with graceful fallback
4. **Modular architecture** where each component (document processing, MCQ generation, XAI, chat) is independently testable

**AI Techniques Used:**
- Large Language Models (prompt engineering, in-context learning)
- Rule-based reasoning (question classification, keyword matching)
- Classical information retrieval (TF-IDF + cosine similarity)
- Symbolic logic (correctness verification, caching)

**Limitations & Future Work:**
- Current implementation uses prompt engineering; fine-tuning on MCQ data could improve quality
- Explanation reasoning is rule-based; learned validaton (e.g., BERT-based ranking) could enhance semantic understanding
- Difficulty inference is static; reinforcement learning could adapt to student performance
- TF-IDF is simple; BERT embeddings or dense retrieval would be more contextually aware

---

## 9. CONCLUSION

| Question | Answer |
|----------|--------|
| **Is this RAG?** | No. This is in-context learning + optional evidence retrieval, not true RAG. |
| **Is this ADK-native?** | Partially. Uses ADK infrastructure (Agent, Tool, Runner) but not ADK reasoning patterns. |
| **What AI techniques are used?** | LLM (DeepSeek/Ollama), rule-based reasoning, TF-IDF retrieval, symbolic logic. |
| **What AI techniques are NOT used?** | Fine-tuned models, learned ranking, NER, knowledge graphs, RL, multi-agent coordination. |
| **AI Contribution Level?** | **MODERATE.** Solid integration of multiple techniques; good for FYP; not research-grade. |
| **Code Quality?** | **GOOD.** Modular, well-documented, explainable; follows software engineering best practices. |

---

**Analysis Date:** January 13, 2026  
**Analysis Scope:** Full backend + frontend codebase  
**Methodology:** Static code analysis, architectural review, technique classification
