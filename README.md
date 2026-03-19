# Web Analysis Platform

A comprehensive full-stack platform for analyzing websites with AI-powered insights, knowledge graph visualization, topical mapping, and competitive comparison.

## Features

- 🌐 **Multi-URL Analysis**: Analyze up to 5 websites simultaneously
- 🕸️ **Knowledge Graph**: Interactive visualization of entities and relationships
- 📊 **Topical Mapping**: Semantic analysis with business insights, target audiences, and search intent
- ⚖️ **Comparison**: Side-by-side analysis of business models, services, technologies, and features
- 🔐 **Google Authentication**: Secure login with Google OAuth 2.0
- 🎨 **Modern UI**: Beautiful glassmorphism design with smooth animations

## Tech Stack

### Backend
- **FastAPI**: High-performance Python web framework
- **BeautifulSoup4**: Web scraping
- **NetworkX**: Knowledge graph generation
- **Google OAuth**: Authentication
- **Async/Await**: Concurrent URL processing

### Frontend
- **React 18**: Modern UI library
- **Vite**: Lightning-fast build tool
- **React Force Graph**: Interactive graph visualization
- **Axios**: HTTP client
- **Google OAuth**: Authentication integration

## Getting Started

### Prerequisites

- Python 3.9+
- Node.js 18+
- Google Cloud account (for OAuth)

### Backend Setup

1. Navigate to backend directory:
```bash
cd backend
```

2. Create virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Mac/Linux
# or
venv\Scripts\activate  # On Windows
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Create `.env` file from example:
```bash
cp .env.example .env
```

5. Configure Google OAuth:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing one
   - Enable Google+ API
   - Create OAuth 2.0 credentials
   - Add authorized redirect URIs: `http://localhost:5173/auth/callback`
   - Copy Client ID and Client Secret to `.env`

6. Run the backend:
```bash
python main.py
```

Backend will run on `http://localhost:8000`

### Frontend Setup

1. Navigate to frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file:
```bash
cp .env.example .env
```

4. Add your Google Client ID to `.env`:
```
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

5. Run the frontend:
```bash
npm run dev
```

Frontend will run on `http://localhost:5173`

## Usage

1. **Login**: Click "Sign in with Google" button
2. **Enter URLs**: Add 1-5 website URLs to analyze
3. **Analyze**: Click "Analyze Websites" button
4. **View Results**:
   - **Knowledge Graph**: Explore entity relationships
   - **Topical Map**: Review business insights and audience analysis
   - **Comparison**: Compare features across websites (2+ URLs required)

## API Endpoints

### Authentication
- `POST /auth/google/login` - Google OAuth login
- `POST /auth/logout` - Logout
- `GET /auth/me` - Get current user

### Analysis
- `POST /api/analyze` - Submit URLs for analysis
- `GET /api/results/{analysis_id}` - Get complete results
- `GET /api/knowledge-graph/{analysis_id}` - Get knowledge graph
- `GET /api/topical-map/{analysis_id}` - Get topical analysis
- `GET /api/compare/{analysis_id}` - Get comparison data
- `GET /api/history` - Get user's analysis history

## Google OAuth Setup Guide

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Navigate to "APIs & Services" > "Credentials"
4. Click "Create Credentials" > "OAuth client ID"
5. Choose "Web application"
6. Add authorized JavaScript origins:
   - `http://localhost:5173`
7. Add authorized redirect URIs:
   - `http://localhost:5173/auth/callback`
8. Copy the Client ID and Client Secret
9. Add to backend `.env`:
   ```
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```
10. Add Client ID to frontend `.env`:
    ```
    VITE_GOOGLE_CLIENT_ID=your-client-id
    ```

## Project Structure

```
web/
├── backend/
│   ├── api/
│   │   └── routes.py          # API endpoints
│   ├── auth/
│   │   └── auth.py            # Google OAuth handler
│   ├── services/
│   │   ├── scraper.py         # Web scraping
│   │   ├── knowledge_graph.py # Graph generation
│   │   ├── topical_map.py     # Topical analysis
│   │   └── comparator.py      # Comparison engine
│   ├── config.py              # Configuration
│   ├── main.py                # FastAPI app
│   └── requirements.txt       # Python dependencies
│
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── GoogleAuth.jsx
    │   │   ├── URLInput.jsx
    │   │   ├── KnowledgeGraph.jsx
    │   │   ├── TopicalMap.jsx
    │   │   └── Comparison.jsx
    │   ├── context/
    │   │   └── AuthContext.jsx
    │   ├── utils/
    │   │   └── api.js
    │   ├── App.jsx
    │   └── main.jsx
    └── package.json
```

## Features Explained

### Knowledge Graph
- Visualizes relationships between business entities
- Color-coded nodes by type (domain, service, audience, technology, location)
- Interactive exploration with zoom and pan
- Click nodes for details

### Topical Map
- Business description (150-250 words)
- Central entity identification
- Search intent analysis
- Target audience segmentation
- Source context (business model, conversion methods)

### Comparison
- Business model comparison
- Service overlap analysis
- Audience comparison
- Technology stack analysis
- Geographic coverage
- Unique feature identification
- Similarity matrix

## Development

### Backend
```bash
cd backend
source venv/bin/activate && uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend
```bash
cd frontend
npm run dev
```

## License

MIT

## Support

For issues or questions, please open an issue on GitHub.
