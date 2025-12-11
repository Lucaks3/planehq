"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";

interface Change {
  taskMappingId: string;
  planeIssueName: string | null;
  asanaTaskName: string | null;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  source: "plane" | "asana";
  changedAt: string | null;
}

interface ChangesResponse {
  planeChanges: Change[];
  asanaChanges: Change[];
  summary: {
    planeChanges: number;
    asanaChanges: number;
    totalLinked: number;
    errors?: number;
  };
}

interface ProjectMapping {
  id: string;
  planeProjectName: string;
  asanaProjectName: string;
}

export default function ChangesPage() {
  const params = useParams();
  const mappingId = params.mappingId as string;
  const queryClient = useQueryClient();

  // Fetch project mapping info
  const { data: mappings } = useQuery<ProjectMapping[]>({
    queryKey: ["mappings"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      const data = await res.json();
      return data.mappings;
    },
  });

  const currentMapping = mappings?.find((m) => m.id === mappingId);

  // Fetch changes
  const {
    data: changes,
    isLoading,
    refetch,
  } = useQuery<ChangesResponse>({
    queryKey: ["changes", mappingId],
    queryFn: async () => {
      const res = await fetch(`/api/mappings/${mappingId}/changes`);
      if (!res.ok) throw new Error("Failed to fetch changes");
      return res.json();
    },
  });

  // Take snapshot mutation
  const snapshotMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/mappings/${mappingId}/changes`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to take snapshot");
      return res.json();
    },
    onSuccess: (data) => {
      const errorMsg = data.errorCount > 0 ? ` (${data.errorCount} errors - some tasks may have been deleted)` : "";
      alert(`Snapshot created for ${data.snapshotCount} tasks${errorMsg}`);
      queryClient.invalidateQueries({ queryKey: ["changes", mappingId] });
    },
    onError: (error) => {
      alert(`Error: ${error.message}`);
    },
  });

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const getFieldIcon = (field: string) => {
    switch (field) {
      case "name":
        return "T";
      case "description":
        return "D";
      case "state":
        return "S";
      case "completed":
        return "C";
      case "comments":
        return "#";
      case "new":
        return "+";
      default:
        return "?";
    }
  };

  const getFieldLabel = (field: string) => {
    switch (field) {
      case "name":
        return "Title";
      case "description":
        return "Description";
      case "state":
        return "State";
      case "completed":
        return "Status";
      case "comments":
        return "Comments";
      case "new":
        return "New Task";
      default:
        return field;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-4 mb-2">
            <Link
              href={`/tasks/${mappingId}`}
              className="text-gray-600 hover:text-gray-900"
            >
              &larr; Back to Tasks
            </Link>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Changes Overview
              </h1>
              {currentMapping && (
                <p className="text-gray-600">
                  {currentMapping.planeProjectName} &harr;{" "}
                  {currentMapping.asanaProjectName}
                </p>
              )}
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={() => refetch()}
                disabled={isLoading}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50"
                title="Checks for changes since last snapshot. Asana comments may take ~30 seconds to check."
              >
                {isLoading ? "Checking..." : "Refresh"}
              </button>
              <button
                onClick={() => snapshotMutation.mutate()}
                disabled={snapshotMutation.isPending}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                title="Captures current state of all tasks including comment counts. May take 30-60 seconds."
              >
                {snapshotMutation.isPending ? "Taking snapshot... (this may take a minute)" : "Take Snapshot"}
              </button>
            </div>
          </div>
        </div>

        {/* Summary */}
        {changes && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-white p-4 rounded-lg shadow">
              <div className="text-3xl font-bold text-blue-600">
                {changes.summary.planeChanges}
              </div>
              <div className="text-gray-600">Plane Changes</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow">
              <div className="text-3xl font-bold text-purple-600">
                {changes.summary.asanaChanges}
              </div>
              <div className="text-gray-600">Asana Changes</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow">
              <div className="text-3xl font-bold text-gray-600">
                {changes.summary.totalLinked}
              </div>
              <div className="text-gray-600">Linked Tasks</div>
            </div>
            {changes.summary.errors !== undefined && changes.summary.errors > 0 && (
              <div className="bg-white p-4 rounded-lg shadow border-l-4 border-red-400">
                <div className="text-3xl font-bold text-red-600">
                  {changes.summary.errors}
                </div>
                <div className="text-gray-600">Skipped (deleted)</div>
              </div>
            )}
          </div>
        )}

        {/* Two column layout */}
        <div className="grid grid-cols-2 gap-6">
          {/* Plane changes */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-4 border-b bg-blue-50">
              <h2 className="text-lg font-semibold text-blue-900">
                Plane Changes
              </h2>
              <p className="text-sm text-blue-700">
                Changes made in Plane since last snapshot
              </p>
            </div>
            <div className="p-4 max-h-[600px] overflow-y-auto">
              {isLoading ? (
                <div className="text-center text-gray-500 py-8">Loading...</div>
              ) : changes?.planeChanges.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  No changes detected
                </div>
              ) : (
                <div className="space-y-3">
                  {changes?.planeChanges.map((change, idx) => (
                    <div
                      key={`plane-${idx}`}
                      className="border rounded-lg p-3 hover:bg-gray-50"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded bg-blue-100 text-blue-700 flex items-center justify-center font-mono text-sm">
                          {getFieldIcon(change.field)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900 truncate">
                            {change.planeIssueName}
                          </div>
                          <div className="text-sm text-gray-600">
                            {getFieldLabel(change.field)} changed
                          </div>
                          {change.field !== "new" && (
                            <div className="mt-2 text-sm">
                              <div className="flex items-center gap-2">
                                <span className="text-red-600 line-through truncate max-w-[200px]">
                                  {change.oldValue || "(empty)"}
                                </span>
                                <span className="text-gray-400">&rarr;</span>
                                <span className="text-green-600 truncate max-w-[200px]">
                                  {change.newValue || "(empty)"}
                                </span>
                              </div>
                            </div>
                          )}
                          {change.changedAt && (
                            <div className="text-xs text-gray-400 mt-1">
                              {formatDate(change.changedAt)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Asana changes */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-4 border-b bg-purple-50">
              <h2 className="text-lg font-semibold text-purple-900">
                Asana Changes
              </h2>
              <p className="text-sm text-purple-700">
                Changes made in Asana since last snapshot
              </p>
            </div>
            <div className="p-4 max-h-[600px] overflow-y-auto">
              {isLoading ? (
                <div className="text-center text-gray-500 py-8">Loading...</div>
              ) : changes?.asanaChanges.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  No changes detected
                </div>
              ) : (
                <div className="space-y-3">
                  {changes?.asanaChanges.map((change, idx) => (
                    <div
                      key={`asana-${idx}`}
                      className="border rounded-lg p-3 hover:bg-gray-50"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded bg-purple-100 text-purple-700 flex items-center justify-center font-mono text-sm">
                          {getFieldIcon(change.field)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900 truncate">
                            {change.asanaTaskName}
                          </div>
                          <div className="text-sm text-gray-600">
                            {getFieldLabel(change.field)} changed
                          </div>
                          {change.field !== "new" && (
                            <div className="mt-2 text-sm">
                              <div className="flex items-center gap-2">
                                <span className="text-red-600 line-through truncate max-w-[200px]">
                                  {change.oldValue || "(empty)"}
                                </span>
                                <span className="text-gray-400">&rarr;</span>
                                <span className="text-green-600 truncate max-w-[200px]">
                                  {change.newValue || "(empty)"}
                                </span>
                              </div>
                            </div>
                          )}
                          {change.changedAt && (
                            <div className="text-xs text-gray-400 mt-1">
                              {formatDate(change.changedAt)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Info box */}
        <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="font-medium text-yellow-800 mb-2">How it works</h3>
          <ul className="text-sm text-yellow-700 space-y-1">
            <li>
              1. Click &quot;Take Snapshot&quot; to save the current state of all
              linked tasks (may take ~1 minute to fetch comment counts)
            </li>
            <li>
              2. Make changes in Plane or Asana (edit titles, descriptions, states,
              add comments, etc.)
            </li>
            <li>
              3. Click &quot;Refresh&quot; to see what changed since the snapshot
            </li>
            <li>
              4. Go to Tasks page to sync changes, then take a new snapshot
            </li>
          </ul>
          <div className="mt-2 text-xs text-yellow-600">
            Tracked fields: Title, Description, State (Plane), Completion (Asana), Comments
          </div>
        </div>
      </div>
    </div>
  );
}
