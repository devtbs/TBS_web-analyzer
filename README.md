<p align="center">
  <img src="./frontend/public/TBS-Logo.webp" alt="TBS Marketing Logo" width="180px" />
</p>

# TBS Web Analysis & SEO Platform

A premium, full-stack SEO powerhouse and web analysis platform. It combines AI-powered website insights (Knowledge Graphs, Topical Mapping) with real-time Google Search Console analytics to provide a comprehensive view of digital performance.

![Premium Dashboard](./frontend/public/ReadMe.png)

## 🌟 Core Features

### 📊 SEO Analytics Dashboard (New)
- **Direct GSC Integration**: Securely connect Google Search Console properties.
- **Performance Metrics**: Real-time tracking of Clicks, Impressions, Avg. CTR, and Avg. Position.
- **Interactive Visualization**: Dynamic historical bar charts with daily/weekly/monthly grouping.
- **Smart Classification**: Automated ranking of pages into categories like "Quick Wins," "Opportunities," "Top Results," and "Decaying."
- **Entity Clustering**: Intelligent keyword clustering to identify semantic search trends.
- **Excel Export**: Generate comprehensive SEO reports with a single click.

### 🧠 AI Web Analysis
- **Knowledge Graph**: Interactive 3D/2D visualization of entity relationships and service maps.
- **Topical Mapping**: Semantic depth analysis, audience segmentation, and search intent discovery.
- **Competitive Comparison**: Side-by-side analysis of business models, tech stacks, and geographic reach.
-**ContentWriter**: Professional, high-quality article generation based on the analysis (English and Thai).
- **Custom Writing Prompts**: Users can fine-tune and control the writing output by customising the Writing System Prompt.
- **Multi-URL Processing**: Analyze up to 5 competitors simultaneously.
- **Background Processing**: Heavy analysis tasks run asynchronously, allowing you to browse while the AI thinks.

## 🛠️ Tech Stack

### Backend
- **FastAPI**: Ultra-fast Python framework with async capabilities.
- **SQLAlchemy & PostgreSQL**: Robust data persistence for user history and tokens.
- **Google OAuth 2.0**: Secure authentication for user accounts and Search Console access.
- **Groq/DeepSeek**: Powering the semantic analysis and knowledge extraction.

### Frontend
- **React 18**: Built for performance and reliability.
- **Vite**: Modern build orchestration.
- **Recharts**: Professional, interactive data visualization.
- **Framer Motion**: Smooth, high-end micro-animations and transitions.
- **Tailwind CSS**: Custom "Glassmorphism" design system.

## 🚀 Getting Started

### Prerequisites
- Python 3.9+ 
- Node.js 18+
- PostgreSQL database
- Google Cloud Console Project (with Search Console API enabled)

### 1. Environment Configuration

#### Backend (`backend/.env`)
```env
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
SECRET_KEY=your_jwt_secret
ALLOWED_ORIGINS=http://localhost:5173
```

#### Frontend (`frontend/.env`)
```env
VITE_GOOGLE_CLIENT_ID=your_client_id
VITE_API_BASE_URL=
```

### 2. Installation

**Backend Setup:**
```bash
cd backend
python -m venv venv
pip install -r requirements.txt
source venv/bin/activate && uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

**Frontend Setup:**
```bash
cd frontend
npm install
npm run dev
```

## 🔐 Google OAuth Configuration

To enable fully functional Search Console integration, ensure your Google Cloud project is configured with:

1.  **Scopes**: 
    - `https://www.googleapis.com/auth/userinfo.email`
    - `https://www.googleapis.com/auth/userinfo.profile`
    - `https://www.googleapis.com/auth/webmasters.readonly` (Search Console)
2.  **Redirect URIs**:
    - `http://localhost:5173/auth/callback`
3.  **Client Configuration**: Set `Access Type` to `Offline` to allow the platform to refresh tokens in the background.

## ✍️ AI Content & Custom Writing Prompts

The platform generates comprehensive SEO articles based on a two-step AI generation flow:
1. **Brief Generation**: Analyzes the topic, category, and article type to output a detailed structure/brief.
2. **Article Generation**: Uses the brief along with custom style instructions to generate the final article in Markdown.

### Controlling the Writing Style (Writer Prompt Settings)
Users can fine-tune and control the writing output by customising the **Writing System Prompt**:
* **Where to find it**: In the **Topical Map** view (after running an analysis), click the **Settings** (gear icon) button next to "Export Map to PDF".
* **Language Support**: Supports independent settings for both **English** (🇬🇧) and **Thai** (🇹🇭).
* **How it works**:
  - The customized prompt is saved in the browser's `localStorage` (`writing_prompt_en` / `writing_prompt_th`).
  - When generating an article, the frontend passes this prompt as the `system_prompt` field in the payload to `POST /api/article/{analysis_id}`.
  - If left blank, it falls back to the default SEO-optimized prompts defined in `backend/services/brief_generator.py` (`DEFAULT_EN_SYSTEM_PROMPT` / `DEFAULT_TH_SYSTEM_PROMPT`).

---

## 📁 Project Structure

```text
web/
├── backend/
│   ├── api/
│   │   └── routes.py              # All REST API endpoints (analysis, GSC, articles, auth)
│   ├── auth/
│   │   └── auth.py                # JWT token creation and verification
│   ├── models/
│   │   └── schemas.py             # Pydantic request/response schemas
│   ├── services/
│   │   ├── ai_service.py          # OpenAI & DeepSeek API integration wrapper
│   │   ├── brief_generator.py     # SEO article brief + full article generation
│   │   ├── comparator.py          # Side-by-side competitor comparison logic
│   │   ├── gsc_service.py         # Google Search Console data integration
│   │   ├── knowledge_graph.py     # Knowledge graph entity extraction
│   │   ├── scraper.py             # Web scraping and content extraction
│   │   ├── serp_service.py        # SerpAPI integration for SERP analysis
│   │   ├── sitemap_service.py     # Sitemap parsing and URL discovery
│   │   └── topical_map.py         # Topical map generation and semantic analysis
│   ├── utils/
│   │   ├── progress_tracker.py    # SSE-based real-time progress tracking
│   │   ├── storage.py             # In-memory analysis result storage
│   │   └── user_manager.py        # User session management helpers
│   ├── config.py                  # App settings loaded from .env
│   ├── database.py                # SQLAlchemy engine & PostgreSQL session setup
│   ├── main.py                    # FastAPI app entry point & CORS configuration
│   └── requirements.txt           # Python dependencies
└── frontend/
    ├── src/
    │   ├── api/
    │   │   └── axios.js           # Axios instance with base URL configuration
    │   ├── components/
    │   │   ├── ui/                # Reusable UI primitives (Button, Card, Badge, etc.)
    │   │   ├── visualizations/
    │   │   │   ├── KnowledgeGraph.jsx   # Interactive 3D/2D knowledge graph
    │   │   │   ├── TopicalMap.jsx       # Topical map view with article writer & prompt settings
    │   │   │   └── Comparison.jsx       # Competitor comparison panel
    │   │   ├── layout/            # App shell, sidebar, and navigation components
    │   │   ├── modals/            # Modal dialog components
    │   │   ├── editor/            # Article/document editor components
    │   │   ├── gsc/               # GSC-specific chart and data components
    │   │   └── auth/              # Login and OAuth callback components
    │   ├── context/
    │   │   └── AuthContext.jsx    # Global auth state & Google OAuth flow
    │   ├── pages/
    │   │   ├── Dashboard.jsx      # Main SEO analytics overview
    │   │   ├── SEOAnalytics.jsx   # Detailed GSC metrics and query analytics
    │   │   ├── NewAnalysis.jsx    # Competitor URL input and analysis launcher
    │   │   ├── Results.jsx        # Analysis results with tab navigation
    │   │   ├── Documents.jsx      # Article/document management page
    │   │   ├── DocumentDetail.jsx # Single article editor and publisher
    │   │   ├── History.jsx        # Past analysis history
    │   │   ├── MySites.jsx        # User's connected GSC properties
    │   │   ├── PagesPage.jsx      # Page-level GSC performance data
    │   │   ├── QueriesPage.jsx    # Keyword/query performance data
    │   │   ├── CountriesPage.jsx  # Geographic performance breakdown
    │   │   ├── GlobalReports.jsx  # Aggregated cross-site reporting
    │   │   ├── NewLostRankingsPage.jsx # New vs. lost keyword rankings
    │   │   └── PageSelector.jsx   # Property/page selection utility
    │   ├── App.jsx                # Route definitions
    │   └── main.jsx               # React app entry point
    └── index.html                 # HTML shell
```

---

## 🚧 Developer Hand-off & Next Steps

This project is ready for production hand-off. Key areas for future developers:

### 1. Database
* **PostgreSQL**: The project uses PostgreSQL for data persistence via SQLAlchemy.
* **Database Migrations**: Schema changes are currently applied manually. Alembic can be added for structured versioned migrations.

### 2. Deployment & CI/CD
* **Deployment Guide**: See [DEPLOYMENT.md](./DEPLOYMENT.md) for full instructions on running the app on your Hostinger VPS with Nginx and PM2.
* **Local Setup**: See [QUICKSTART.md](./QUICKSTART.md) for running the app locally.

---

## 📄 License
MIT © TBS Marketing

## 🤝 Support
For technical support or feature requests, contact the development lead or open an internal issue.

