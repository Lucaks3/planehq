const PLANE_API_BASE = "https://api.plane.so/api/v1";

interface PlaneConfig {
  apiKey: string;
  workspaceSlug: string;
}

export interface PlaneProject {
  id: string;
  name: string;
  identifier: string;
  description: string;
}

export interface PlaneState {
  id: string;
  name: string;
  group: "backlog" | "unstarted" | "started" | "completed" | "cancelled";
  color: string;
}

export interface PlaneIssue {
  id: string;
  name: string;
  description_html?: string;
  state: string; // state ID
  state_detail?: PlaneState;
  project: string;
  sequence_id: number;
  created_at: string;
  updated_at: string;
}

export interface PlaneComment {
  id: string;
  comment_html: string;
  actor_detail?: {
    id: string;
    display_name: string;
  };
  created_at: string;
}

class PlaneClient {
  private apiKey: string;
  private workspaceSlug: string;

  constructor(config: PlaneConfig) {
    this.apiKey = config.apiKey;
    this.workspaceSlug = config.workspaceSlug;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${PLANE_API_BASE}/workspaces/${this.workspaceSlug}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        "x-api-key": this.apiKey,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Plane API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  // Projects
  async listProjects(): Promise<PlaneProject[]> {
    const data = await this.request<{ results: PlaneProject[] }>("/projects/");
    return data.results;
  }

  // States
  async listStates(projectId: string): Promise<PlaneState[]> {
    const data = await this.request<{ results: PlaneState[] }>(
      `/projects/${projectId}/states/`
    );
    return data.results;
  }

  // Work Items (Issues)
  async listIssues(projectId: string): Promise<PlaneIssue[]> {
    const data = await this.request<{ results: PlaneIssue[] }>(
      `/projects/${projectId}/work-items/`
    );
    return data.results;
  }

  async getIssue(projectId: string, issueId: string): Promise<PlaneIssue> {
    return this.request<PlaneIssue>(
      `/projects/${projectId}/work-items/${issueId}/`
    );
  }

  async updateIssue(
    projectId: string,
    issueId: string,
    data: Partial<Pick<PlaneIssue, "name" | "description_html" | "state">>
  ): Promise<PlaneIssue> {
    return this.request<PlaneIssue>(
      `/projects/${projectId}/work-items/${issueId}/`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      }
    );
  }

  // Comments
  async listComments(
    projectId: string,
    issueId: string
  ): Promise<PlaneComment[]> {
    const data = await this.request<{ results: PlaneComment[] }>(
      `/projects/${projectId}/work-items/${issueId}/comments/`
    );
    return data.results;
  }

  async createComment(
    projectId: string,
    issueId: string,
    commentHtml: string
  ): Promise<PlaneComment> {
    return this.request<PlaneComment>(
      `/projects/${projectId}/work-items/${issueId}/comments/`,
      {
        method: "POST",
        body: JSON.stringify({ comment_html: commentHtml }),
      }
    );
  }
}

// Singleton instance
let planeClient: PlaneClient | null = null;

export function getPlaneClient(): PlaneClient {
  if (!planeClient) {
    const apiKey = process.env.PLANE_API_KEY;
    const workspaceSlug = process.env.PLANE_WORKSPACE_SLUG;

    if (!apiKey || !workspaceSlug) {
      throw new Error(
        "PLANE_API_KEY and PLANE_WORKSPACE_SLUG must be set in environment"
      );
    }

    planeClient = new PlaneClient({ apiKey, workspaceSlug });
  }

  return planeClient;
}

// Webhook signature verification
export function verifyPlaneSignature(
  payload: string,
  signature: string | null
): boolean {
  if (!signature) return false;

  const secret = process.env.PLANE_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("PLANE_WEBHOOK_SECRET not set, skipping verification");
    return true; // Allow in dev mode
  }

  // Plane uses HMAC SHA256 for signature verification
  const crypto = require("crypto");
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

export { PlaneClient };
