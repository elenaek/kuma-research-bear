<div style="text-align: center" align="center">

<img src="public/icons/icon-192.png" />

# Kuma the Research Bear

> **Making research papers accessible to everyone, powered by Chrome's Built-in AI**

[![Chrome Built-in AI Challenge 2025](https://img.shields.io/badge/Google%20Chrome-Built--in%20AI%20Challenge%202025-4285F4?style=for-the-badge&logo=google-chrome&logoColor=white)](https://devpost.com/software/kuma-the-research-bear)
[![Chrome Built-in AI Documentation](https://img.shields.io/badge/Google%20Chrome-Built--in%20AI%20Documentation%202025-4285F4?style=for-the-badge&logo=google-chrome&logoColor=white)](https://developer.chrome.com/docs/ai/built-in)
[![Chrome Version](https://img.shields.io/badge/Chrome-138%2B-4285F4?style=for-the-badge&logo=google-chrome)](https://www.google.com/chrome/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

**Kuma the Research Bear** is an intelligent Chrome extension that transforms how students, researchers and even the common person interacts with academic papers. Leveraging **Chrome's Built-in AI APIs**, and hybrid retrieval-augmented generation (RAG), Kuma makes dense research papers understandable for just about anyone, while helping you write better papers and essays.

---

**Quick Navigation:**
[🎯 Problem](#the-problem) • [💡 Solution](#the-solution) • [✨ Features](#-key-features) • [🏗️ Architecture](#%EF%B8%8F-technical-architecture) • [🚀 Installation](#-installation) • [📖 Usage](#-usage-guide) • [🏆 Hackathon](#-chrome-built-in-ai-challenge-2025-keypoints) • [🛣️ Roadmap](#-future-roadmap) • [🛠️ Development](#-development) • [🔗 Links](#-links)

</div>

---

## The Problem

- **Research papers are dense and inaccessible** – Complex jargon, statistical methods, and academic writing create barriers for the common person, students and even researchers when in a non-native field
- **Understanding takes a long time** – Reading and comprehending a single paper can take hours
- **Writing requires efficient research** – Students need to understand, analyze, and cite papers quickly
- **Privacy concerns with cloud AI** – Sending sensitive research to external APIs raises privacy issues

## The Solution

Kuma the Research Bear brings **AI-powered research assistance directly into your browser** with:

- **3 Chrome Built-in AI APIs** – Prompt API (Gemini Nano), Summarizer API, Language Detector API
- **100% Local Processing** – All AI runs on-device with no data leaving your browser
- **In-Browser Hybrid RAG System** – Combines semantic search (EmbeddingGemma 300m) with keyword search (BM25)
- **Multimodal Understanding** – Explain text, figures, charts, and custom screen captures
- **Intelligent Analysis** – 4-part deep analysis of methodology, confounders, implications, and limitations
- **Smart Glossary** – AI-powered term extraction with context-aware definitions
- **Citation Export** – One-click export in APA, MLA, IEEE, or Chicago formats

---

## ✨ Key Features

<details>

<summary> 

### 🦾 Chrome Built-in AI Integration 

Kuma showcases **all three** Chrome Built-in AI APIs:

</summary>


#### **1. Prompt API (Gemini Nano)**
- **Primary AI engine** powering all core features
- **Structured output** with JSON schema constraints for reliable data extraction
- **Context management** with automatic conversation summarization at 70% token quota
- **Multimodal support** for image explanations with visual context
- **Streaming responses** for real-time user feedback
- **Powers:** Explanations, analysis, glossary generation, Q&A, chat, image explanations

#### **2. Summarizer API**
- **Two-mode summarization:**
  - `tldr` – Quick one-paragraph summaries
  - `key-points` – Structured bullet-point takeaways
- **Language-aware** multilingual output
- **Fallback to Prompt API** when unavailable

#### **3. Language Detector API**
- **Automatic language detection** for research papers
- **Multilingual support:** English, Spanish, Japanese
- **Adaptive responses** in user's preferred language

---

</details>

<details>

<summary>

### 🧠 Hybrid RAG (Retrieval-Augmented Generation)

Kuma uses a sophisticated **two-tier retrieval system** to find the most relevant paper sections for answering questions:

</summary>


#### **Semantic Search (EmbeddingGemma)**
- **308M parameter embedding model** running locally in-browser via Transformers.js
- **WebGPU acceleration** with WASM fallback for maximum performance
- **Matryoshka truncation** to 256 dimensions for storage efficiency
- **Task-specific prefixes** optimizing query vs. document embeddings
- **Privacy-first:** All embeddings generated locally

#### **Keyword Search (BM25)**
- **OkapiBM25 algorithm** for statistical text ranking
- **Fast fallback** when embeddings unavailable
- **No model loading** required

#### **Adaptive Context Selection**
- **Dynamic chunk selection** based on device input quota
- **Budget-aware trimming** to fit within token limits
- **Hierarchical preservation** of document structure
- **Conversation summarization** to free space for RAG context

---

</details>

<details>

<summary>

### 🖼️ Multimodal Chat System

Discuss images, graphs, and paper text with Kuma.

</summary>


#### **Text Chat**
- **Streaming AI responses** with real-time generation
- **Source citations** with hierarchical section references
- **Scroll-to-source** – Click citations to jump to relevant text
- **LaTeX rendering** for mathematical formulas
- **Conversation memory** with automatic summarization

#### **Image Chat**
- **Multi-tabbed interface** – Separate chat per image
- **Blob persistence** in IndexedDB
- **Paper + image context** – Combines RAG from paper and image
- **Screen capture support** – Explain custom-captured regions from PDFs

---

</details>

<details>

<summary>

### 📊 Intelligent Paper Analysis

Leverage built-in AI to perform deep analysis helping you understand paper methodology, confounders, biases, generalizability

</summary>

**4-Part Deep Analysis:**

1. **Methodology Analysis** – Research design, validity, statistical approaches
2. **Confounders Analysis** – Potential biases and confounding variables
3. **Implications Analysis** – Real-world impact and significance
4. **Limitations Analysis** – Study constraints and future research directions

**Summary of Summaries (Map-Reduce/Metasummarization)** for large papers:
- Automatic chunking for papers >6000 characters
- Progressive UI updates as sections complete
- Chunk-level term extraction for key concepts

---

</details>

<details>

<summary>

### 📖 Smart Glossary Generation

Generate glossaries for research papers

</summary>

#### **Transformer-based Keyword Extraction**
- **Context-aware** considering paper title and content
- **AI-powered deduplication** consolidates similar terms
- **10 terms per chunk** for balanced coverage

#### **RAG-Enhanced Definitions**
- **Semantic search** finds relevant context for each term
- **Batch processing** generates 5 definitions per API call
- **Progressive loading** shows terms as they're generated
- **Multilingual support** adapts to user's language

---

</details>

<details>

<summary>

### 📄 Advanced PDF Processing

Works with PDFs as well as HTML

</summary>

#### **Text Extraction**
- **PDF.js integration** for client-side parsing
- **Structure preservation** maintains formatting
- **Natural boundary chunking** at paragraph/sentence level
- **Metadata extraction** with hierarchical section relationships

#### **Screen Capture**
- **Custom region selection** via click-and-drag
- **Crosshair cursor** for visual feedback
- **Blob storage** with overlay position tracking
- **Auto-cleanup** when tab closes

---

</details>

<details>

<summary>

### 🎭 Persona/Purpose System

Customize AI responses for your use case:

</summary>

#### **Personas**
- **Professional** – Formal, technical, precise tone
- **Student** – Accessible, supportive, pedagogical tone

#### **Purposes**
- **Writing** – Citation-ready, structured for academic papers
- **Learning** – Understanding-focused, exploratory explanations

All system prompts dynamically adapt to your selection, with preferences saved to Chrome storage.

---

</details>

<details>

<summary>

### 🔍 Intelligent Paper Detection

Multiple levels of paper detection for graceful degradation

</summary>

#### **Auto-detection for Popular Research Sites:**
- arXiv
- PubMed
- bioRxiv
- Google Scholar
- SSRN

#### **AI-Powered Fallback Detection:**
- Uses Prompt API to extract metadata from unknown sites
- Detects title, authors, abstract, DOI, publication date

---

</details>

<details>


<summary>

### 🎨 Polished Sidepanel UI

UX-first sidepanel design

</summary>

#### **Organized Tabs:**
- **Summary** – TLDR + Key Points with Summarizer API
- **Explanation** – Simplified abstract for quick understanding
- **Analysis** – 4-part deep analysis with progress tracking
- **Glossary** – Interactive term definitions with progressive loading
- **Q&A** – Question history with cited, verifiable answers
- **Original Paper** – View stored paper content with hierarchical sections
- **Citations** – Export in APA, MLA, Chicago, or BibTeX

#### **UX Features:**
- Multi-paper management with navigation
- Progress tracking with completion percentage badges
- Real-time operation progress banners
- Lottie animations with cute bear mascot states
- Settings integration (persona/purpose/language)

---

</details>

<details>

<summary>

### 🖱️ Content Script Features

Interact with papers conveniently

</summary>

#### **Selection Toolbar**
- Appears on text selection
- "Ask Kuma" button for contextual explanations
- Seamless integration with chat

#### **Image Explain Buttons**
- Auto-detection on figures/charts
- One-click explanations
- Persistent result storage
- Screen capture explanations

#### **Floating Chatbox**
- Resizable and draggable
- Tab-specific visibility state
- Integrated with sidepanel

---

</details>

## 🏗️ Technical Architecture

### Tech Stack

#### **Frontend**
- **Preact** – Lightweight React alternative (10KB)
- **TypeScript** – Full type safety
- **Tailwind CSS 4.1** – Utility-first styling with modern features
- **Vite** – Modern build tool with HMR
- **Lucide Preact** – Icon library
- **Marked** – Markdown rendering
- **MathJax** – LaTeX math rendering
- **DOMPurify** – XSS protection
- **Lottie** – Animated mascot

#### **AI/ML**
- **Chrome Prompt API** – Gemini Nano LLM
- **Chrome Summarizer API** – Native summarization
- **Chrome Language Detector API** – Language detection
- **Transformers.js 3.1** – EmbeddingGemma model (308M params)
- **ONNX Runtime** – WebGPU/WASM inference
- **OkapiBM25** – Keyword search algorithm

#### **PDF Processing**
- **PDF.js 5.4** – Mozilla's PDF renderer
- **Custom text extraction** – Structure-preserving parser

#### **Storage**
- **IndexedDB** – Papers, chunks, embeddings, chat history, images
- **Chrome Sync Storage** – Settings, operation state, preferences

#### **Build System**
- **Vite Plugin Web Extension** – Auto-reload during development
- **PostCSS** – CSS processing
- **Terser** – JavaScript minification

---

### System Workflow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                   User Clicks Detect Paper                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Paper Detection & Extraction                 │
│  • Site-specific detectors (arXiv, PubMed, etc.)                │
│  • AI-powered fallback for unknown sites                        │
│  • PDF.js text extraction with structure preservation           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Paper Processing Pipeline                  │
│  1. Chunk text into semantic units (paragraphs/sentences)       │
│  2. Generate embeddings with EmbeddingGemma (WebGPU/WASM)       │
│  3. Store in IndexedDB (paper, chunks, embeddings)              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      User Interactions                          │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   Summary    │  │ Explanation  │  │   Analysis   │           │
│  ├──────────────┤  ├──────────────┤  ├──────────────┤           │
│  │ Summarizer   │  │  Prompt API  │  │  Prompt API  │           │
│  │     API      │  │   + RAG      │  │ Multi-stage  │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   Glossary   │  │     Q&A      │  │     Chat     │           │
│  ├──────────────┤  ├──────────────┤  ├──────────────┤           │
│  │   KeyBERT    │  │ Hybrid RAG   │  │ Multimodal   │           │
│  │  + Prompt    │  │  + Prompt    │  │ RAG + Images │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

---

### Hybrid RAG Workflow Diagram

```
         User Question
            │
            ▼
┌─────────────────────────────────────┐
│   Detect Language (Language API)    │
└────────────┬────────────────────────┘
             │
             ▼
     ┌───────────────┐
     │ Embeddings    │
     │ Available?    │
     └───┬───────┬───┘
         │       │
     Yes │       │ No
         ▼       ▼
   ┌──────────┐  ┌──────────┐
   │ Semantic │  │ Keyword  │
   │  Search  │  │ Search   │
   │(Embedding│  │  (BM25)  │
   │  Gemma)  │  │          │
   └────┬─────┘  └────┬─────┘
        │             │
        └──────┬──────┘
               │
               ▼
    ┌────────────────────┐
    │ Retrieve Top-K     │
    │ Relevant Chunks    │
    └─────────┬──────────┘
              │
              ▼
    ┌────────────────────┐
    │ Adaptive Trimming  │
    │ (Budget-aware)     │
    └─────────┬──────────┘
              │
              ▼
    ┌────────────────────┐
    │ Conversation       │
    │ Summarization      │
    │ (if needed)        │
    └─────────┬──────────┘
              │
              ▼
    ┌────────────────────┐
    │ Prompt API         │
    │ (Gemini Nano)      │
    │ + RAG Context      │
    └─────────┬──────────┘
              │
              ▼
    Streaming Response
    with Citations
```

---

## 🚀 Installation

### Prerequisites

- **Chrome 138+** with experimental AI features enabled

### Hardware Requirements

Before installing Kuma, ensure your system meets these requirements for Chrome's Built-in AI:

#### **Operating System**
- ✅ **Windows 10 or 11**
- ✅ **macOS 13+ (Ventura and onwards)**
- ✅ **Linux**
- ✅ **ChromeOS** (Chromebook Plus devices)
- ❌ **Not Supported:** Chrome for Android, iOS, non-Chromebook Plus ChromeOS devices

#### **Storage**
- **22 GB minimum** free space on the volume containing your Chrome profile
- ⚠️ **Auto-cleanup:** If available space drops below 10 GB after model download, Gemini Nano will remove itself and redownload once space is available

#### **Processing Power** (Choose ONE of the following)

**Option 1 - GPU:**
- **Strictly more than 4 GB VRAM**

**Option 2 - CPU:**
- **16 GB RAM or more** AND
- **4 CPU cores or more**

#### **Network**
- **Unlimited/unmetered connection** required for initial model download (~1-2 GB)
- Wi-Fi and ethernet typically work
- ⚠️ Metered connections (cellular data) may cause issues

#### **Language Support**
- **Chrome 140+:** English, Spanish, Japanese for input and output
- Earlier versions: English only

> **Note:** If you don't meet the GPU/CPU requirements, you can use the `EnabledBypassPerfRef` flag (mentioned in Setup section) for testing, but performance will be significantly degraded.

---

### Setup Chrome AI APIs

1. **Enable AI flags** in `chrome://flags`:
   ```
   chrome://flags/#prompt-api-for-gemini-nano → Enabled Multilingual
   chrome://flags/#prompt-api-for-gemini-nano-multimodal-input → Enabled Multilingual
   chrome://flags/#summarization-api-for-gemini-nano → Enabled Multilingual
   chrome://flags/#optimization-guide-on-device-model → Enabled (EnabledBypassPerfRef if wanting to test without good hardware but won't work well)
   ```

2. **Restart Chrome**

### Install Extension

#### Option 1: Load Unpacked (Development)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/elenaek/kuma-research-bear.git
   cd kuma-research-bear
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the extension:**
   ```bash
   npm run build
   ```

4. **Load in Chrome:**
   - Navigate to `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

#### Option 2: Download Github Release

1. **Download ZIP from Github Releases**

2. **Extract from ZIP**

2. **Load in Chrome** (same as above, but extension will auto-reload on code changes)

---

## 📖 Usage Guide

### Getting Started

1. **Open a research paper** from websites or PDF (web or local on chrome):
   - Ones that work well: arXiv, PubMed, bioRxiv, Google Scholar, SSRN
   - Or any site with a PDF

2. **Click the Kuma extension icon** in the Chrome extension toolbar, or right click a page with a research paper > expand the Kuma menu.

3. **Click "Detect and Explain Paper"**

4. **Wait for paper processing:**
   - Text extraction from PDF
   - Chunking into semantic units
   - Embedding generation (first time only)
   - Progress shown in sidepanel

5. **Enjoy**
   - Discuss images with Kuma to understand by right clicking them and clicking "Discuss Image"
   - Discuss screenshots with Kuma by right clicking and clicking "Capture Screenshot and Discuss with Kuma" to select custom areas
   - Chat with Kuma about the paper(s) (powered by hybrid RAG)
   - Use sidepanel for quickly assessing papers with structured information

### Core Features

#### **📝 Summary**
- View quick TLDR summary
- Read structured key points
- Generated using Chrome Summarizer API

#### **💡 Explanation**
- Get simplified structured information about the overall paper
- Understand paper's main contribution
- Uses Prompt API with RAG

#### **🔬 Analysis**
- Explore methodology, confounders, implications, limitations
- 4-part deep analysis generated progressively
- Click badges to view completion status
- Uses Summary of summaries (Map-Reduce) + Hybrid Search to create a comprehensive analysis of papers

#### **📖 Glossary**
- Review AI-extracted key terms
- Click terms for context-aware definitions
- Definitions generated in batches of 5
- Progressive loading with real-time updates

#### **❓ Q&A**
- Ask specific questions about the paper
- Get cited answers with source references
- Click citations to scroll to relevant sections
- View question history
- Kuma has more context window to think here compared to the chat interface
- LaTeX support

#### **💬 Chat**
- **Text Chat:** Conversational AI with paper context
- **Image Chat:** Explains and discusses figures, charts, or screen captures
- **Cites Sources:** When Kuma uses context from a paper sources are shown underneath the message
- **Scroll-to-Image/Source:** Click on images or sources to automatically scroll to them
- Multi-tabbed interface for multiple images
- Streaming responses with LaTeX support

#### **📎 Citations**
- Export in 4 formats: APA, MLA, Chicago, BibTeX
- One-click copy to clipboard

### Advanced Features

#### **Screen Capture**
- Right-Click any stored paper and click "Capture Screenshot and Discuss with Kuma"
- Cursor changes to crosshair
- Click and drag to select any screen region you wish to get an explanation of
- Release to capture and get an explanation and discuss the captured region with Kuma

#### **Selection Toolbar**
- Highlight text in paper
- Click "Ask Kuma" button
- Get contextual explanation in chat

#### **Settings**
- **Persona:** Professional or Student tone
- **Purpose:** Writing Essay or Learning focus
- **Language:** English, Spanish, Japanese
- Settings apply to all AI responses

### Multi-Paper Management

- Navigate between papers using dropdown
- Each paper has independent processing state
- Chat history and settings persist per paper
- Delete papers to free storage

---

## 🏆 Chrome Built-in AI Challenge 2025 Keypoints

#### **1. Chrome Built-in AI API Integration**
- **Chrome Extension using 3 Chrome Built-in AI APIs**
- Prompt API, Summarizer API, Language Detector API
- Demonstrates breadth and depth of Chrome AI ecosystem

#### **2. Advanced Hybrid RAG**
- **Combines semantic + keyword search**
- Local EmbeddingGemma (308M params) via Transformers.js
- Adaptive chunking with token budget management
- Conversation-aware context optimization
- Intelligently scales to use WebGPU (fp32) or WASM + quantized model (q4, only 3% precision loss)

#### **3. Multimodal Understanding**
- **Text + Image inputs** with unified RAG system
- Discuss papers with Kuma
- Screen capture workflow for custom explanations
- Multi-tabbed image chat interface

#### **4. Privacy-First Design**
- **100% local processing** – No data leaves browser
- On-device embeddings with WebGPU acceleration
- Chrome Built-in AI runs locally on Gemini Nano
- IndexedDB for secure storage

#### **5. Production-Ready UX**
- **Progressive loading** – Progressively load in content as it completes generation
- **Real-time streaming** – Immediate user feedback
- **Source citations** – Verifiable, trustworthy answers
- **Lottie animations** – Polished, delightful experience

#### **6. Technical Excellence**
- **Chat Rolling Summarization with Message Buffer:** Allows Kuma to remember your most current conversations precisely without losing too much context over time
- **Adapts to Input Quota:** Adapts to different input quotas
- **Performance optimization:** WebGPU with WASM fallback
- **Error handling:** Graceful fallbacks for all AI features
- **Accessibility:** Multilingual support, adaptive personas

#### **7. Practical Value**
- **Solves real problems** for students and researchers
- **Saves time** with AI-powered understanding
- **Improves writing** with citation-ready information
- **Democratizes research paper understanding** by making papers accessible to everyone

---

## 🛣️ Future Roadmap

### Planned Features

- [ ] **Translation API** – Translate papers between languages
- [ ] **Hybrid AI** - Leverage Cloud LLMs for less powerful hardware
- [ ] **Inference Pseudo-Preemption** - Use a CPU Scheduling-like round robin algorithm with aging or priority FIFO queue to provide better process scheduling e.g. Chat inferencing comes first for better UX
- [ ] **Agentic Resarch** - Implement agent research team, allowing Kuma to retrieve other related papers
- [ ] **Knowledge Map** - Show interrelations between papers quickly and visually through a knowledge map
- [ ] **Formulas Tab** - Sidepanel tab showing all of the formulas used (in LaTeX), along with explanations/study context for each
- [ ] **Collaborative Research** – Share papers and notes with team
- [ ] **Citation Network** – Visualize paper relationships
- [ ] **Voice Narration** – Audio explanations of papers
- [ ] **Mobile Sync** – Cross-device paper library

### Planned Enhancements

- Major refactor of codebase (Gotta clean up typescript errors, lol)
- Better metadata extraction
- Improved PDF extraction/structure retaining
- Improve LaTeX rendering/stability

---

## 🛠️ Development

### Project Structure

```
kuma-research-bear/
├── src/
│   ├── background/          # Service worker, message handling
│   ├── content/             # Content scripts, injection
│   ├── sidepanel/           # Main UI (Preact components)
│   ├── services/            # AI APIs, RAG, storage, PDF processing
│   ├── utils/               # Helpers, chunking, detection
│   ├── types/               # TypeScript definitions
│   └── assets/              # Images, Lottie animations
├── public/                  # Static assets, manifest.json
├── dist/                    # Built extension (generated)
├── vite.config.ts           # Vite build configuration
├── tailwind.config.js       # Tailwind CSS configuration
└── package.json             # Dependencies and scripts
```

### Build Commands

```bash
# Install dependencies
npm install

# Development mode (hot reload)
npm run dev

# Production build
npm run build

# Type checking
npm run type-check

# Linting
npm run lint
```

### Key Technologies

- **Vite Plugin Web Extension** – Enables HMR for extension development
- **Preact** – Lightweight React alternative for fast rendering
- **Transformers.js** – Run ML models in browser with WebGPU/WASM
- **IndexedDB** – Persistent storage for papers and embeddings
- **Chrome Extension Manifest V3** – Modern extension architecture

---

## 📄 License

This project uses a **dual licensing** approach:

### Source Code - MIT License
The source code is licensed under the **MIT License** – see the [LICENSE](LICENSE) file for details. You are free to use, modify, and distribute the code.

### Visual Assets - All Rights Reserved
The **Kuma bear mascot**, Lottie animations, and all branding elements are **NOT** covered by the MIT License. These assets are proprietary and protected under copyright – see the [ASSETS_LICENSE](ASSETS_LICENSE) file for details. Written permission is required for any use of these visual assets.

---

## 🙏 Acknowledgments

- **DevPost/Google** - For hosting/sponsoring this great hackathon
- **Google Chrome Team** – For creating powerful Built-in AI APIs

---

## 🔗 Links

- **Demo Video:** [YouTube Video](https://youtu.be/gnCz6BK_hx0)
- **Devpost Submission:** [Kuma the Research Bear](https://devpost.com/software/kuma-the-research-bear)
- **Chrome Built-in AI Challenge:** [Google Chrome Built-in AI Challenge 2025](https://googlechromeai2025.devpost.com/)

---

<div align="center">

**Made with ❤️ for the Google Chrome Built-in AI Challenge 2025**

🐻 **Kuma the Research Bear – Making Research Accessible to Everyone** 🐻

</div>
