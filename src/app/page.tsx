"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

interface TaskMapping {
  id: string;
  planeIssueId: string | null;
  planeIssueName: string | null;
  asanaTaskGid: string | null;
  asanaTaskName: string | null;
  matchConfidence: number | null;
  matchMethod: string | null;
  syncStatus: string;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  projectMapping: {
    planeProjectName: string;
    asanaProjectName: string;
  };
}

interface MatchSuggestion {
  gid: string;
  name: string;
  confidence: number;
  matchMethod: string;
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [selectedTask, setSelectedTask] = useState<TaskMapping | null>(null);

  // Fetch tasks
  const { data: tasks, isLoading } = useQuery<TaskMapping[]>({
    queryKey: ["tasks"],
    queryFn: async () => {
      const res = await fetch("/api/tasks");
      if (!res.ok) throw new Error("Failed to fetch tasks");
      return res.json();
    },
    refetchInterval: 10000, // Poll every 10 seconds
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async ({
      taskMappingId,
      direction,
    }: {
      taskMappingId: string;
      direction?: string;
    }) => {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskMappingId, direction }),
      });
      if (!res.ok) throw new Error("Sync failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  // Group tasks by status
  const pendingSync = tasks?.filter(
    (t) =>
      t.syncStatus === "PENDING_ASANA_SYNC" ||
      t.syncStatus === "PENDING_PLANE_SYNC"
  );
  const unmatched = tasks?.filter((t) => t.syncStatus === "UNMATCHED");
  const matched = tasks?.filter((t) => t.syncStatus === "MATCHED");
  const synced = tasks?.filter((t) => t.syncStatus === "SYNCED");
  const errors = tasks?.filter((t) => t.syncStatus === "ERROR");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <StatCard
          title="Pending Sync"
          value={pendingSync?.length || 0}
          color="yellow"
        />
        <StatCard
          title="Unmatched"
          value={unmatched?.length || 0}
          color="gray"
        />
        <StatCard title="Matched" value={matched?.length || 0} color="blue" />
        <StatCard title="Synced" value={synced?.length || 0} color="green" />
        <StatCard title="Errors" value={errors?.length || 0} color="red" />
      </div>

      {/* Pending Syncs */}
      {pendingSync && pendingSync.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Ready to Sync
          </h2>
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <ul className="divide-y divide-gray-200">
              {pendingSync.map((task) => (
                <li key={task.id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">
                        {task.planeIssueName || task.asanaTaskName}
                      </p>
                      <p className="text-sm text-gray-500">
                        {task.projectMapping.planeProjectName} →{" "}
                        {task.projectMapping.asanaProjectName}
                      </p>
                      {task.asanaTaskName && task.planeIssueName && (
                        <p className="text-sm text-blue-600">
                          Matched to: {task.asanaTaskName}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center space-x-2">
                      {task.syncStatus === "PENDING_ASANA_SYNC" &&
                        !task.asanaTaskGid && (
                          <button
                            onClick={() => setSelectedTask(task)}
                            className="px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100"
                          >
                            Match Task
                          </button>
                        )}
                      {task.asanaTaskGid && (
                        <button
                          onClick={() =>
                            syncMutation.mutate({ taskMappingId: task.id })
                          }
                          disabled={syncMutation.isPending}
                          className="px-3 py-1.5 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50"
                        >
                          {syncMutation.isPending ? "Syncing..." : "Sync Now"}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Unmatched Tasks */}
      {unmatched && unmatched.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Unmatched Tasks
          </h2>
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <ul className="divide-y divide-gray-200">
              {unmatched.map((task) => (
                <li key={task.id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">
                        {task.planeIssueName || task.asanaTaskName}
                      </p>
                      <p className="text-sm text-gray-500">
                        {task.planeIssueName ? "From Plane" : "From Asana"} •{" "}
                        {task.projectMapping.planeProjectName}
                      </p>
                    </div>
                    <button
                      onClick={() => setSelectedTask(task)}
                      className="px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100"
                    >
                      Find Match
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Recent Syncs */}
      {synced && synced.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Recently Synced
          </h2>
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <ul className="divide-y divide-gray-200">
              {synced.slice(0, 10).map((task) => (
                <li key={task.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">
                        {task.planeIssueName}
                      </p>
                      <p className="text-sm text-gray-500">
                        Synced{" "}
                        {task.lastSyncedAt
                          ? new Date(task.lastSyncedAt).toLocaleString()
                          : "recently"}
                      </p>
                    </div>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      Synced
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Empty State */}
      {(!tasks || tasks.length === 0) && (
        <div className="text-center py-12">
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No tasks yet
          </h3>
          <p className="text-gray-500 mb-4">
            Set up a project mapping in Settings to start syncing tasks.
          </p>
          <a
            href="/settings"
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
          >
            Go to Settings
          </a>
        </div>
      )}

      {/* Match Modal */}
      {selectedTask && (
        <MatchModal
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onMatched={() => {
            setSelectedTask(null);
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
          }}
        />
      )}
    </div>
  );
}

function StatCard({
  title,
  value,
  color,
}: {
  title: string;
  value: number;
  color: "yellow" | "gray" | "blue" | "green" | "red";
}) {
  const colors = {
    yellow: "bg-yellow-50 text-yellow-700 border-yellow-200",
    gray: "bg-gray-50 text-gray-700 border-gray-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    green: "bg-green-50 text-green-700 border-green-200",
    red: "bg-red-50 text-red-700 border-red-200",
  };

  return (
    <div className={`p-4 rounded-lg border ${colors[color]}`}>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}

function MatchModal({
  task,
  onClose,
  onMatched,
}: {
  task: TaskMapping;
  onClose: () => void;
  onMatched: () => void;
}) {
  const [search, setSearch] = useState("");

  // Fetch suggestions
  const { data: suggestions, isLoading } = useQuery<{
    planeTaskName: string;
    suggestions: MatchSuggestion[];
  }>({
    queryKey: ["suggestions", task.id],
    queryFn: async () => {
      const res = await fetch(
        `/api/tasks/suggestions?taskMappingId=${task.id}`
      );
      if (!res.ok) throw new Error("Failed to fetch suggestions");
      return res.json();
    },
  });

  // Match mutation
  const matchMutation = useMutation({
    mutationFn: async (suggestion: MatchSuggestion) => {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskMappingId: task.id,
          asanaTaskGid: suggestion.gid,
          asanaTaskName: suggestion.name,
          matchMethod: suggestion.matchMethod,
        }),
      });
      if (!res.ok) throw new Error("Match failed");
      return res.json();
    },
    onSuccess: () => {
      onMatched();
    },
  });

  const filteredSuggestions = suggestions?.suggestions.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] overflow-hidden">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Match Task</h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>
          <p className="text-sm text-gray-600 mt-1">
            Plane task: <strong>{task.planeIssueName}</strong>
          </p>
        </div>

        <div className="p-4 border-b border-gray-200">
          <input
            type="text"
            placeholder="Search Asana tasks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="overflow-y-auto max-h-96">
          {isLoading ? (
            <div className="p-4 text-center text-gray-500">
              Loading suggestions...
            </div>
          ) : filteredSuggestions && filteredSuggestions.length > 0 ? (
            <ul className="divide-y divide-gray-200">
              {filteredSuggestions.map((suggestion) => (
                <li
                  key={suggestion.gid}
                  className="p-4 hover:bg-gray-50 cursor-pointer"
                  onClick={() => matchMutation.mutate(suggestion)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">
                        {suggestion.name}
                      </p>
                      <p className="text-sm text-gray-500">
                        {suggestion.matchMethod} match •{" "}
                        {Math.round(suggestion.confidence * 100)}% confidence
                      </p>
                    </div>
                    <button
                      disabled={matchMutation.isPending}
                      className="px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 disabled:opacity-50"
                    >
                      {matchMutation.isPending ? "Matching..." : "Select"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4 text-center text-gray-500">
              No matching tasks found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
