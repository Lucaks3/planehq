const ASANA_API_BASE = "https://app.asana.com/api/1.0";

interface AsanaConfig {
  accessToken: string;
}

export interface AsanaWorkspace {
  gid: string;
  name: string;
}

export interface AsanaProject {
  gid: string;
  name: string;
  workspace: { gid: string };
}

export interface AsanaTask {
  gid: string;
  name: string;
  notes?: string;
  html_notes?: string;
  completed: boolean;
  completed_at?: string;
  due_on?: string;
  created_at: string;
  modified_at: string;
  memberships?: { project: { gid: string; name: string } }[];
}

export interface AsanaStory {
  gid: string;
  type: string;
  text?: string;
  html_text?: string;
  created_at: string;
  created_by?: {
    gid: string;
    name: string;
  };
}

class AsanaClient {
  private accessToken: string;

  constructor(config: AsanaConfig) {
    this.accessToken = config.accessToken;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${ASANA_API_BASE}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Asana API error: ${response.status} - ${error}`);
    }

    const json = await response.json();
    return json.data;
  }

  // Workspaces
  async listWorkspaces(): Promise<AsanaWorkspace[]> {
    return this.request<AsanaWorkspace[]>("/workspaces");
  }

  // Projects
  async listProjects(workspaceGid: string): Promise<AsanaProject[]> {
    return this.request<AsanaProject[]>(
      `/workspaces/${workspaceGid}/projects?opt_fields=gid,name,workspace`
    );
  }

  async getProject(projectGid: string): Promise<AsanaProject> {
    return this.request<AsanaProject>(
      `/projects/${projectGid}?opt_fields=gid,name,workspace`
    );
  }

  // Tasks
  async listProjectTasks(projectGid: string): Promise<AsanaTask[]> {
    return this.request<AsanaTask[]>(
      `/projects/${projectGid}/tasks?opt_fields=gid,name,notes,html_notes,completed,completed_at,due_on,created_at,modified_at,memberships.project.gid,memberships.project.name`
    );
  }

  async getTask(taskGid: string): Promise<AsanaTask> {
    return this.request<AsanaTask>(
      `/tasks/${taskGid}?opt_fields=gid,name,notes,html_notes,completed,completed_at,due_on,created_at,modified_at,memberships.project.gid,memberships.project.name`
    );
  }

  async updateTask(
    taskGid: string,
    data: Partial<Pick<AsanaTask, "name" | "notes" | "html_notes" | "completed">>
  ): Promise<AsanaTask> {
    return this.request<AsanaTask>(`/tasks/${taskGid}`, {
      method: "PUT",
      body: JSON.stringify({ data }),
    });
  }

  async createTask(
    projectGid: string,
    data: { name: string; notes?: string; html_notes?: string }
  ): Promise<AsanaTask> {
    return this.request<AsanaTask>("/tasks", {
      method: "POST",
      body: JSON.stringify({
        data: {
          ...data,
          projects: [projectGid],
        },
      }),
    });
  }

  // Stories (Comments)
  async listTaskStories(taskGid: string): Promise<AsanaStory[]> {
    const stories = await this.request<AsanaStory[]>(
      `/tasks/${taskGid}/stories?opt_fields=gid,type,text,html_text,created_at,created_by.gid,created_by.name`
    );
    // Filter to only comments
    return stories.filter((s) => s.type === "comment");
  }

  async createComment(taskGid: string, text: string): Promise<AsanaStory> {
    return this.request<AsanaStory>(`/tasks/${taskGid}/stories`, {
      method: "POST",
      body: JSON.stringify({ data: { text } }),
    });
  }

  // Webhooks
  async createWebhook(
    resourceGid: string,
    targetUrl: string
  ): Promise<{ gid: string }> {
    return this.request<{ gid: string }>("/webhooks", {
      method: "POST",
      body: JSON.stringify({
        data: {
          resource: resourceGid,
          target: targetUrl,
          filters: [
            { resource_type: "task", action: "added" },
            { resource_type: "task", action: "changed" },
            { resource_type: "story", action: "added" },
          ],
        },
      }),
    });
  }

  async deleteWebhook(webhookGid: string): Promise<void> {
    await this.request(`/webhooks/${webhookGid}`, {
      method: "DELETE",
    });
  }
}

// Singleton instance
let asanaClient: AsanaClient | null = null;

export function getAsanaClient(): AsanaClient {
  if (!asanaClient) {
    const accessToken = process.env.ASANA_ACCESS_TOKEN;

    if (!accessToken) {
      throw new Error("ASANA_ACCESS_TOKEN must be set in environment");
    }

    asanaClient = new AsanaClient({ accessToken });
  }

  return asanaClient;
}

// Webhook signature verification
export function verifyAsanaSignature(
  payload: string,
  signature: string | null
): boolean {
  if (!signature) return false;

  const secret = process.env.ASANA_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("ASANA_WEBHOOK_SECRET not set, skipping verification");
    return true; // Allow in dev mode
  }

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

export { AsanaClient };
