"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { use } from "react";

interface PlaneTask {
  id: string;
  name: string;
  state_detail?: { name: string; color: string };
  sequence_id: number;
}

interface AsanaTask {
  gid: string;
  name: string;
  completed: boolean;
}

interface TaskMapping {
  id: string;
  planeIssueId: string | null;
  planeIssueName: string | null;
  asanaTaskGid: string | null;
  asanaTaskName: string | null;
  syncStatus: string;
  matchConfidence: number | null;
  lastSyncedAt: string | null;
}

interface ProjectMapping {
  id: string;
  planeProjectId: string;
  planeProjectName: string;
  asanaProjectGid: string;
  asanaProjectName: string;
  asanaSectionName: string | null;
  triggerStateName: string;
}

interface SuggestedMatch {
  planeTaskId: string;
  planeTaskName: string;
  asanaTaskGid: string;
  asanaTaskName: string;
  confidence: number;
  matchMethod: "exact" | "fuzzy" | "description";
  matchReason: string;
}

export default function TasksPage({ params }: { params: Promise<{ mappingId: string }> }) {
  const { mappingId } = use(params);
  const queryClient = useQueryClient();
  const [selectedPlaneTask, setSelectedPlaneTask] = useState<PlaneTask | null>(null);
  const [selectedAsanaTask, setSelectedAsanaTask] = useState<AsanaTask | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [syncComments, setSyncComments] = useState(false);

  // Fetch all data for this mapping
  const { data, isLoading, error } = useQuery<{
    mapping: ProjectMapping;
    planeTasks: PlaneTask[];
    asanaTasks: AsanaTask[];
    taskMappings: TaskMapping[];
  }>({
    queryKey: ["tasks-overview", mappingId],
    queryFn: async () => {
      const res = await fetch(`/api/mappings/${mappingId}/tasks`);
      if (!res.ok) throw new Error("Failed to fetch tasks");
      return res.json();
    },
  });

  // Fetch auto-match suggestions
  const { data: suggestionsData, isLoading: suggestionsLoading, refetch: refetchSuggestions } = useQuery<{
    suggestions: SuggestedMatch[];
    stats: { totalPlaneTasks: number; totalAsanaTasks: number; alreadyLinked: number; suggestionsFound: number };
  }>({
    queryKey: ["auto-match", mappingId],
    queryFn: async () => {
      const res = await fetch(`/api/mappings/${mappingId}/auto-match`);
      if (!res.ok) throw new Error("Failed to fetch suggestions");
      return res.json();
    },
    enabled: showSuggestions,
  });

  // Create link mutation
  const linkMutation = useMutation({
    mutationFn: async ({ planeTaskId, planeTaskName, asanaTaskGid, asanaTaskName }: {
      planeTaskId: string;
      planeTaskName: string;
      asanaTaskGid: string;
      asanaTaskName: string;
    }) => {
      const res = await fetch(`/api/mappings/${mappingId}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planeTaskId, planeTaskName, asanaTaskGid, asanaTaskName }),
      });
      if (!res.ok) throw new Error("Failed to link tasks");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks-overview", mappingId] });
      queryClient.invalidateQueries({ queryKey: ["auto-match", mappingId] });
      setSelectedPlaneTask(null);
      setSelectedAsanaTask(null);
    },
  });

  // Apply selected suggestions mutation
  const applyMutation = useMutation({
    mutationFn: async (suggestions: SuggestedMatch[]) => {
      const res = await fetch(`/api/mappings/${mappingId}/auto-match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestions }),
      });
      if (!res.ok) throw new Error("Failed to apply matches");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks-overview", mappingId] });
      queryClient.invalidateQueries({ queryKey: ["auto-match", mappingId] });
      setSelectedSuggestions(new Set());
    },
  });

  // Sync task mutation
  const [syncingTaskId, setSyncingTaskId] = useState<string | null>(null);
  const syncMutation = useMutation({
    mutationFn: async ({ taskMappingId, direction, withComments }: { taskMappingId: string; direction: "plane_to_asana" | "asana_to_plane"; withComments: boolean }) => {
      setSyncingTaskId(taskMappingId);
      const res = await fetch(`/api/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskMappingId, direction, syncComments: withComments }),
      });
      if (!res.ok) throw new Error("Failed to sync task");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks-overview", mappingId] });
      setSyncingTaskId(null);
    },
    onError: () => {
      setSyncingTaskId(null);
    },
  });

  // Resync all linked tasks (update Asana names with current formatting)
  const [isResyncingAll, setIsResyncingAll] = useState(false);
  const resyncAllMutation = useMutation({
    mutationFn: async () => {
      setIsResyncingAll(true);
      const res = await fetch(`/api/mappings/${mappingId}/resync-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("Failed to resync tasks");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["tasks-overview", mappingId] });
      setIsResyncingAll(false);
      alert(`Resynced ${data.summary.success} tasks${data.summary.failed > 0 ? ` (${data.summary.failed} failed)` : ""}`);
    },
    onError: () => {
      setIsResyncingAll(false);
    },
  });

  // Import Plane task to Asana
  const [importingPlaneId, setImportingPlaneId] = useState<string | null>(null);
  const importToAsanaMutation = useMutation({
    mutationFn: async (planeIssueId: string) => {
      setImportingPlaneId(planeIssueId);
      const res = await fetch(`/api/mappings/${mappingId}/import-to-asana`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planeIssueIds: [planeIssueId] }),
      });
      if (!res.ok) throw new Error("Failed to import to Asana");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks-overview", mappingId] });
      setImportingPlaneId(null);
    },
    onError: () => {
      setImportingPlaneId(null);
    },
  });

  // Import Asana task to Plane
  const [importingAsanaGid, setImportingAsanaGid] = useState<string | null>(null);
  const importToPlaneMutation = useMutation({
    mutationFn: async (asanaTaskGid: string) => {
      setImportingAsanaGid(asanaTaskGid);
      const res = await fetch(`/api/mappings/${mappingId}/import-from-asana`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asanaTaskGids: [asanaTaskGid] }),
      });
      if (!res.ok) throw new Error("Failed to import to Plane");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks-overview", mappingId] });
      setImportingAsanaGid(null);
    },
    onError: () => {
      setImportingAsanaGid(null);
    },
  });

  // Build lookup maps for linked tasks
  const planeToAsana = new Map<string, TaskMapping>();
  const asanaToPlane = new Map<string, TaskMapping>();

  data?.taskMappings.forEach(tm => {
    if (tm.planeIssueId) planeToAsana.set(tm.planeIssueId, tm);
    if (tm.asanaTaskGid) asanaToPlane.set(tm.asanaTaskGid, tm);
  });

  const handleLink = () => {
    if (selectedPlaneTask && selectedAsanaTask) {
      linkMutation.mutate({
        planeTaskId: selectedPlaneTask.id,
        planeTaskName: selectedPlaneTask.name,
        asanaTaskGid: selectedAsanaTask.gid,
        asanaTaskName: selectedAsanaTask.name,
      });
    }
  };

  const toggleSuggestion = (suggestion: SuggestedMatch) => {
    const key = `${suggestion.planeTaskId}-${suggestion.asanaTaskGid}`;
    const newSelected = new Set(selectedSuggestions);
    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.add(key);
    }
    setSelectedSuggestions(newSelected);
  };

  const handleApplySelected = () => {
    if (!suggestionsData) return;
    const toApply = suggestionsData.suggestions.filter(s =>
      selectedSuggestions.has(`${s.planeTaskId}-${s.asanaTaskGid}`)
    );
    if (toApply.length > 0) {
      applyMutation.mutate(toApply);
    }
  };

  const handleApplyAll = () => {
    if (!suggestionsData?.suggestions.length) return;
    applyMutation.mutate(suggestionsData.suggestions);
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.9) return "text-green-600 bg-green-100";
    if (confidence >= 0.7) return "text-yellow-600 bg-yellow-100";
    return "text-orange-600 bg-orange-100";
  };

  const getMethodBadge = (method: string) => {
    switch (method) {
      case "exact": return "bg-green-100 text-green-800";
      case "fuzzy": return "bg-blue-100 text-blue-800";
      case "description": return "bg-purple-100 text-purple-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading tasks...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500">Failed to load tasks</p>
        <a href="/settings" className="text-blue-600 hover:underline">Back to Settings</a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {data.mapping.planeProjectName} ↔ {data.mapping.asanaProjectName}
          </h1>
          <p className="text-gray-500">
            Trigger state: &quot;{data.mapping.triggerStateName}&quot;
            {data.mapping.asanaSectionName && (
              <> • Asana section: &quot;{data.mapping.asanaSectionName}&quot;</>
            )}
          </p>
        </div>
        <div className="flex items-center space-x-3">
          {/* Sync Comments Toggle */}
          <label className="flex items-center space-x-2 cursor-pointer">
            <span className="text-sm text-gray-600">Sync Comments</span>
            <button
              onClick={() => setSyncComments(!syncComments)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                syncComments ? "bg-green-600" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  syncComments ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </label>
          {/* Resync All Button */}
          <button
            onClick={() => resyncAllMutation.mutate()}
            disabled={isResyncingAll}
            className="px-4 py-2 text-sm font-medium text-green-700 bg-green-100 rounded-md hover:bg-green-200 disabled:opacity-50"
            title="Update all Asana task names with current labels and dates"
          >
            {isResyncingAll ? "Resyncing..." : "Resync All Names"}
          </button>
          {/* View Changes Button */}
          <a
            href={`/changes/${mappingId}`}
            className="px-4 py-2 text-sm font-medium text-orange-700 bg-orange-100 rounded-md hover:bg-orange-200"
            title="View changes since last snapshot"
          >
            View Changes
          </a>
          <button
            onClick={() => { setShowSuggestions(!showSuggestions); if (!showSuggestions) refetchSuggestions(); }}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              showSuggestions
                ? "bg-purple-100 text-purple-700 hover:bg-purple-200"
                : "bg-purple-600 text-white hover:bg-purple-700"
            }`}
          >
            {showSuggestions ? "Hide Suggestions" : "Find Matches"}
          </button>
          <a
            href="/settings"
            className="text-gray-600 hover:text-gray-900"
          >
            &larr; Back to Settings
          </a>
        </div>
      </div>

      {/* Auto-Match Suggestions Panel */}
      {showSuggestions && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-purple-900">Suggested Matches</h3>
              <p className="text-sm text-purple-600">
                Analyzing names and descriptions to find likely matches
              </p>
            </div>
            {suggestionsData && suggestionsData.suggestions.length > 0 && (
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleApplySelected}
                  disabled={selectedSuggestions.size === 0 || applyMutation.isPending}
                  className="px-3 py-1.5 text-sm font-medium text-purple-700 bg-white border border-purple-300 rounded-md hover:bg-purple-50 disabled:opacity-50"
                >
                  Link Selected ({selectedSuggestions.size})
                </button>
                <button
                  onClick={handleApplyAll}
                  disabled={applyMutation.isPending}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50"
                >
                  {applyMutation.isPending ? "Linking..." : `Link All (${suggestionsData.suggestions.length})`}
                </button>
              </div>
            )}
          </div>

          {suggestionsLoading ? (
            <div className="text-center py-8 text-purple-600">Analyzing tasks...</div>
          ) : suggestionsData?.suggestions.length === 0 ? (
            <div className="text-center py-8 text-purple-600">
              No obvious matches found. Try manually linking tasks below.
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {suggestionsData?.suggestions.map(suggestion => {
                const key = `${suggestion.planeTaskId}-${suggestion.asanaTaskGid}`;
                const isSelected = selectedSuggestions.has(key);

                return (
                  <div
                    key={key}
                    onClick={() => toggleSuggestion(suggestion)}
                    className={`p-3 rounded-md cursor-pointer transition-colors ${
                      isSelected ? "bg-purple-200 border-2 border-purple-400" : "bg-white hover:bg-purple-100"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4 flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSuggestion(suggestion)}
                          className="h-4 w-4 text-purple-600 rounded"
                        />
                        <div className="flex-1 min-w-0 grid grid-cols-2 gap-4">
                          <div className="truncate">
                            <span className="text-xs text-gray-500">Plane:</span>
                            <p className="font-medium truncate">{suggestion.planeTaskName}</p>
                          </div>
                          <div className="truncate">
                            <span className="text-xs text-gray-500">Asana:</span>
                            <p className="font-medium truncate">{suggestion.asanaTaskName}</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 ml-4">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded ${getMethodBadge(suggestion.matchMethod)}`}>
                          {suggestion.matchMethod}
                        </span>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded ${getConfidenceColor(suggestion.confidence)}`}>
                          {Math.round(suggestion.confidence * 100)}%
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 ml-8">{suggestion.matchReason}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Link Selection Bar */}
      {(selectedPlaneTask || selectedAsanaTask) && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div>
              <span className="text-sm text-blue-600 font-medium">Plane:</span>{" "}
              {selectedPlaneTask ? (
                <span className="font-medium">{selectedPlaneTask.name}</span>
              ) : (
                <span className="text-gray-400">Select a task</span>
              )}
            </div>
            <span className="text-blue-400">↔</span>
            <div>
              <span className="text-sm text-blue-600 font-medium">Asana:</span>{" "}
              {selectedAsanaTask ? (
                <span className="font-medium">{selectedAsanaTask.name}</span>
              ) : (
                <span className="text-gray-400">Select a task</span>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => { setSelectedPlaneTask(null); setSelectedAsanaTask(null); }}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              onClick={handleLink}
              disabled={!selectedPlaneTask || !selectedAsanaTask || linkMutation.isPending}
              className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {linkMutation.isPending ? "Linking..." : "Link Tasks"}
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">Plane Tasks</p>
          <p className="text-2xl font-bold">{data.planeTasks.length}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">Asana Tasks</p>
          <p className="text-2xl font-bold">{data.asanaTasks.length}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">Linked</p>
          <p className="text-2xl font-bold text-green-600">
            {data.taskMappings.filter(tm => tm.planeIssueId && tm.asanaTaskGid).length}
          </p>
        </div>
        <div className="bg-white p-4 rounded-lg border">
          <p className="text-sm text-gray-500">Unlinked</p>
          <p className="text-2xl font-bold text-gray-400">
            {data.planeTasks.filter(t => !planeToAsana.has(t.id)).length +
             data.asanaTasks.filter(t => !asanaToPlane.has(t.gid)).length}
          </p>
        </div>
      </div>

      {/* Two Column Task View */}
      <div className="grid grid-cols-2 gap-6">
        {/* Plane Tasks */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="p-4 border-b border-gray-200 bg-gray-50">
            <h2 className="font-semibold text-gray-900">
              Plane Tasks ({data.planeTasks.length})
            </h2>
          </div>
          <div className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
            {data.planeTasks.map(task => {
              const mapping = planeToAsana.get(task.id);
              const isSelected = selectedPlaneTask?.id === task.id;
              const isLinked = !!mapping?.asanaTaskGid;

              return (
                <div
                  key={task.id}
                  onClick={() => !isLinked && setSelectedPlaneTask(isSelected ? null : task)}
                  className={`p-3 cursor-pointer transition-colors ${
                    isSelected ? "bg-blue-50 border-l-4 border-blue-500" :
                    isLinked ? "bg-green-50" : "hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium truncate ${isLinked ? "text-green-800" : "text-gray-900"}`}>
                        {task.name}
                      </p>
                      <div className="flex items-center space-x-2 mt-1">
                        {task.state_detail && (
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                            style={{
                              backgroundColor: task.state_detail.color + "20",
                              color: task.state_detail.color,
                            }}
                          >
                            {task.state_detail.name}
                          </span>
                        )}
                        <span className="text-xs text-gray-400">#{task.sequence_id}</span>
                        {isLinked && mapping.lastSyncedAt && (
                          <span className="text-xs text-gray-400">
                            Synced {new Date(mapping.lastSyncedAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-2 ml-2">
                      {isLinked ? (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              syncMutation.mutate({ taskMappingId: mapping.id, direction: "plane_to_asana", withComments: syncComments });
                            }}
                            disabled={syncingTaskId === mapping.id}
                            className="px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 rounded hover:bg-blue-100 disabled:opacity-50"
                            title="Sync Plane → Asana"
                          >
                            {syncingTaskId === mapping.id ? "..." : "→ Asana"}
                          </button>
                          <span className="text-xs text-green-600 whitespace-nowrap">
                            → {mapping.asanaTaskName}
                          </span>
                        </>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            importToAsanaMutation.mutate(task.id);
                          }}
                          disabled={importingPlaneId === task.id}
                          className="px-2 py-1 text-xs font-medium text-orange-600 bg-orange-50 rounded hover:bg-orange-100 disabled:opacity-50"
                          title="Create in Asana"
                        >
                          {importingPlaneId === task.id ? "..." : "+ Asana"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {data.planeTasks.length === 0 && (
              <div className="p-4 text-center text-gray-500">No tasks found</div>
            )}
          </div>
        </div>

        {/* Asana Tasks */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="p-4 border-b border-gray-200 bg-gray-50">
            <h2 className="font-semibold text-gray-900">
              Asana Tasks ({data.asanaTasks.length})
            </h2>
          </div>
          <div className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
            {data.asanaTasks.map(task => {
              const mapping = asanaToPlane.get(task.gid);
              const isSelected = selectedAsanaTask?.gid === task.gid;
              const isLinked = !!mapping?.planeIssueId;

              return (
                <div
                  key={task.gid}
                  onClick={() => !isLinked && setSelectedAsanaTask(isSelected ? null : task)}
                  className={`p-3 cursor-pointer transition-colors ${
                    isSelected ? "bg-blue-50 border-l-4 border-blue-500" :
                    isLinked ? "bg-green-50" : "hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium truncate ${isLinked ? "text-green-800" : "text-gray-900"}`}>
                        {task.name}
                      </p>
                      <div className="flex items-center space-x-2 mt-1">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          task.completed
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-600"
                        }`}>
                          {task.completed ? "Completed" : "Open"}
                        </span>
                        {isLinked && mapping.lastSyncedAt && (
                          <span className="text-xs text-gray-400">
                            Synced {new Date(mapping.lastSyncedAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-2 ml-2">
                      {isLinked ? (
                        <>
                          <span className="text-xs text-green-600 whitespace-nowrap">
                            ← {mapping.planeIssueName}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              syncMutation.mutate({ taskMappingId: mapping.id, direction: "asana_to_plane", withComments: syncComments });
                            }}
                            disabled={syncingTaskId === mapping.id}
                            className="px-2 py-1 text-xs font-medium text-purple-600 bg-purple-50 rounded hover:bg-purple-100 disabled:opacity-50"
                            title="Sync Asana → Plane"
                          >
                            {syncingTaskId === mapping.id ? "..." : "→ Plane"}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            importToPlaneMutation.mutate(task.gid);
                          }}
                          disabled={importingAsanaGid === task.gid}
                          className="px-2 py-1 text-xs font-medium text-orange-600 bg-orange-50 rounded hover:bg-orange-100 disabled:opacity-50"
                          title="Create in Plane"
                        >
                          {importingAsanaGid === task.gid ? "..." : "+ Plane"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {data.asanaTasks.length === 0 && (
              <div className="p-4 text-center text-gray-500">No tasks found</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
