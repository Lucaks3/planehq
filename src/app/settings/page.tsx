"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

interface ProjectMapping {
  id: string;
  planeProjectId: string;
  planeProjectName: string;
  asanaProjectGid: string;
  asanaProjectName: string;
  asanaSectionName: string | null;
  triggerStateName: string;
  syncEnabled: boolean;
  _count: { taskMappings: number };
}

interface PlaneProject {
  id: string;
  name: string;
}

interface AsanaProject {
  gid: string;
  name: string;
}

export default function Settings() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async (mappingId: string) => {
      const res = await fetch(`/api/projects/${mappingId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete mapping");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setDeletingId(null);
    },
  });

  // Fetch projects data
  const { data, isLoading } = useQuery<{
    mappings: ProjectMapping[];
    planeProjects: PlaneProject[];
    asanaProjects: AsanaProject[];
  }>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
  });

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-500">
            Configure project mappings and sync settings
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
        >
          Add Mapping
        </button>
      </div>

      {/* API Status */}
      <section className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">API Status</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center space-x-3">
            <div
              className={`w-3 h-3 rounded-full ${
                data?.planeProjects && data.planeProjects.length > 0
                  ? "bg-green-500"
                  : "bg-red-500"
              }`}
            />
            <span className="text-gray-700">
              Plane API:{" "}
              {data?.planeProjects && data.planeProjects.length > 0
                ? `Connected (${data.planeProjects.length} projects)`
                : "Not connected"}
            </span>
          </div>
          <div className="flex items-center space-x-3">
            <div
              className={`w-3 h-3 rounded-full ${
                data?.asanaProjects && data.asanaProjects.length > 0
                  ? "bg-green-500"
                  : "bg-red-500"
              }`}
            />
            <span className="text-gray-700">
              Asana API:{" "}
              {data?.asanaProjects && data.asanaProjects.length > 0
                ? `Connected (${data.asanaProjects.length} projects)`
                : "Not connected"}
            </span>
          </div>
        </div>
        <p className="mt-4 text-sm text-gray-500">
          Set PLANE_API_KEY, PLANE_WORKSPACE_SLUG, and ASANA_ACCESS_TOKEN in
          your .env file
        </p>
      </section>

      {/* Project Mappings */}
      <section className="bg-white rounded-lg shadow overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Project Mappings
          </h2>
          <p className="text-sm text-gray-500">
            Link Plane projects to Asana projects
          </p>
        </div>

        {isLoading ? (
          <div className="p-6 text-center text-gray-500">Loading...</div>
        ) : data?.mappings && data.mappings.length > 0 ? (
          <ul className="divide-y divide-gray-200">
            {data.mappings.map((mapping) => (
              <li key={mapping.id} className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">
                      {mapping.planeProjectName} → {mapping.asanaProjectName}
                    </p>
                    <p className="text-sm text-gray-500">
                      Trigger: &quot;{mapping.triggerStateName}&quot;
                      {mapping.asanaSectionName && (
                        <> • Section: &quot;{mapping.asanaSectionName}&quot;</>
                      )}
                      {" "}• {mapping._count.taskMappings} tasks mapped
                    </p>
                  </div>
                  <div className="flex items-center space-x-3">
                    <a
                      href={`/tasks/${mapping.id}`}
                      className="px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100"
                    >
                      View Tasks
                    </a>
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        mapping.syncEnabled
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {mapping.syncEnabled ? "Active" : "Disabled"}
                    </span>
                    <button
                      onClick={() => {
                        if (confirm(`Delete mapping "${mapping.planeProjectName} → ${mapping.asanaProjectName}"? This will also remove all linked tasks.`)) {
                          setDeletingId(mapping.id);
                          deleteMutation.mutate(mapping.id);
                        }
                      }}
                      disabled={deletingId === mapping.id}
                      className="px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100 disabled:opacity-50"
                    >
                      {deletingId === mapping.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-6 text-center text-gray-500">
            No project mappings yet. Add one to start syncing.
          </div>
        )}
      </section>

      {/* Add Mapping Modal */}
      {showForm && data && (
        <AddMappingModal
          planeProjects={data.planeProjects}
          asanaProjects={data.asanaProjects}
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ["projects"] });
          }}
        />
      )}
    </div>
  );
}

function AddMappingModal({
  planeProjects,
  asanaProjects,
  onClose,
  onCreated,
}: {
  planeProjects: PlaneProject[];
  asanaProjects: AsanaProject[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [planeProjectId, setPlaneProjectId] = useState("");
  const [asanaProjectGid, setAsanaProjectGid] = useState("");
  const [asanaSectionName, setAsanaSectionName] = useState("");
  const [triggerStateName, setTriggerStateName] = useState("Ready for Customer");

  const createMutation = useMutation({
    mutationFn: async () => {
      const planeProject = planeProjects.find((p) => p.id === planeProjectId);
      const asanaProject = asanaProjects.find((p) => p.gid === asanaProjectGid);

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planeProjectId,
          planeProjectName: planeProject?.name || planeProjectId,
          asanaProjectGid,
          asanaProjectName: asanaProject?.name || asanaProjectGid,
          asanaSectionName: asanaSectionName || null,
          triggerStateName,
        }),
      });
      if (!res.ok) throw new Error("Failed to create mapping");
      return res.json();
    },
    onSuccess: () => {
      onCreated();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Add Project Mapping</h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Plane Project
            </label>
            <select
              value={planeProjectId}
              onChange={(e) => setPlaneProjectId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select a project...</option>
              {planeProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Asana Project
            </label>
            <select
              value={asanaProjectGid}
              onChange={(e) => setAsanaProjectGid(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select a project...</option>
              {asanaProjects.map((p) => (
                <option key={p.gid} value={p.gid}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Asana Section Filter (Optional)
            </label>
            <input
              type="text"
              value={asanaSectionName}
              onChange={(e) => setAsanaSectionName(e.target.value)}
              placeholder="e.g., Content"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-sm text-gray-500">
              Only show tasks from this section/group in Asana
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Trigger State Name
            </label>
            <input
              type="text"
              value={triggerStateName}
              onChange={(e) => setTriggerStateName(e.target.value)}
              placeholder="e.g., Ready for Customer"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-sm text-gray-500">
              When a Plane task reaches this state, it will be ready to sync
            </p>
          </div>
        </div>

        <div className="p-4 border-t border-gray-200 flex justify-end space-x-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={
              !planeProjectId ||
              !asanaProjectGid ||
              !triggerStateName ||
              createMutation.isPending
            }
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {createMutation.isPending ? "Creating..." : "Create Mapping"}
          </button>
        </div>
      </div>
    </div>
  );
}
