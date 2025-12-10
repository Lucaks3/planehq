# PlaneHQ - Plane ↔ Asana Sync

A middleware application for syncing tasks between Plane.so and Asana with manual approval workflow.

## Features

- **Bidirectional Sync**: Sync tasks from Plane to Asana and vice versa
- **Fuzzy Matching**: Intelligent task matching with confidence scores
- **Manual Approval**: Review and approve syncs before they happen
- **Comment Sync**: Sync comments between systems
- **Multi-Project**: Map multiple Plane projects to Asana projects
- **Configurable Triggers**: Set custom trigger states per project

## Getting Started

### Prerequisites

- Node.js 18+
- Plane.so API key
- Asana Personal Access Token

### Installation

1. Clone the repository:
```bash
git clone https://github.com/Lucaks3/planehq.git
cd planehq
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` with your credentials:
```
DATABASE_URL="file:./dev.db"
PLANE_WORKSPACE_SLUG="your-workspace-slug"
PLANE_API_KEY="your-plane-api-key"
ASANA_ACCESS_TOKEN="your-asana-token"
```

4. Initialize the database:
```bash
npx prisma migrate dev
```

5. Run the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the dashboard.

## Usage

### Setting Up Project Mappings

1. Go to Settings
2. Click "Add Mapping"
3. Select a Plane project and Asana project
4. Set the trigger state (e.g., "Ready for Customer")
5. Save the mapping

### Syncing Tasks

When a Plane task reaches the trigger state:
1. It appears in the dashboard as "Ready to Sync"
2. Match it to an Asana task (or use auto-suggested match)
3. Click "Sync Now" to push updates

### Webhooks

For real-time updates, configure webhooks:

**Plane Webhook URL:** `https://your-domain.com/api/webhooks/plane`
**Asana Webhook URL:** `https://your-domain.com/api/webhooks/asana`

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Database**: SQLite (Prisma)
- **UI**: Tailwind CSS
- **State**: TanStack Query
- **Matching**: Fuse.js

## License

MIT
