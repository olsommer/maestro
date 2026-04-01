"use client";

import { create } from "zustand";
import type { Agent, Project } from "./api";

interface AgentSummary {
  id: string;
  projectId: string | null;
  projectLabel: string;
  status: string;
}

export interface AppState {
  agentIds: string[];
  agentsById: Record<string, Agent>;
  projects: Project[];
  selectedAgentId: string | null;
  selectedProjectId: string | null;
  setAgents: (agents: Agent[]) => void;
  setProjects: (projects: Project[]) => void;
  updateAgent: (id: string, patch: Partial<Agent>) => void;
  updateProject: (id: string, patch: Partial<Project>) => void;
  addAgent: (agent: Agent) => void;
  addProject: (project: Project) => void;
  removeAgent: (id: string) => void;
  removeProject: (id: string) => void;
  selectAgent: (id: string | null) => void;
  selectProject: (id: string | null) => void;
}

function normalizeAgents(agents: Agent[]): {
  agentIds: string[];
  agentsById: Record<string, Agent>;
} {
  const agentsById: Record<string, Agent> = {};
  const agentIds: string[] = [];

  for (const agent of agents) {
    agentsById[agent.id] = agent;
    agentIds.push(agent.id);
  }

  return { agentIds, agentsById };
}

export const useStore = create<AppState>((set) => ({
  agentIds: [],
  agentsById: {},
  projects: [],
  selectedAgentId: null,
  selectedProjectId: null,

  setAgents: (agents) => set(normalizeAgents(agents)),
  setProjects: (projects) =>
    set((state) => ({
      projects,
      selectedProjectId:
        state.selectedProjectId && projects.some((p) => p.id === state.selectedProjectId)
          ? state.selectedProjectId
          : projects[0]?.id ?? null,
    })),

  updateAgent: (id, patch) =>
    set((state) => {
      const agent = state.agentsById[id];
      if (!agent) {
        return state;
      }

      return {
        agentsById: {
          ...state.agentsById,
          [id]: { ...agent, ...patch },
        },
      };
    }),
  updateProject: (id, patch) =>
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === id ? { ...project, ...patch } : project
      ),
    })),

  addAgent: (agent) =>
    set((state) => ({
      agentIds: state.agentsById[agent.id] ? state.agentIds : [agent.id, ...state.agentIds],
      agentsById: {
        ...state.agentsById,
        [agent.id]: agent,
      },
    })),
  addProject: (project) =>
    set((state) => ({
      projects: [project, ...state.projects],
      selectedProjectId: project.id,
    })),

  removeAgent: (id) =>
    set((state) => {
      if (!state.agentsById[id]) {
        return state;
      }

      const agentsById = { ...state.agentsById };
      delete agentsById[id];
      return {
        agentIds: state.agentIds.filter((agentId) => agentId !== id),
        agentsById,
        selectedAgentId: state.selectedAgentId === id ? null : state.selectedAgentId,
      };
    }),
  removeProject: (id) =>
    set((state) => {
      const projects = state.projects.filter((project) => project.id !== id);
      return {
        projects,
        selectedProjectId:
          state.selectedProjectId === id
            ? projects[0]?.id ?? null
            : state.selectedProjectId,
      };
    }),

  selectAgent: (id) => set({ selectedAgentId: id }),
  selectProject: (id) => set({ selectedProjectId: id }),
}));

export function selectAgents(state: AppState): Agent[] {
  return state.agentIds
    .map((id) => state.agentsById[id])
    .filter((agent): agent is Agent => Boolean(agent));
}

export function selectAgentById(id: string) {
  return (state: AppState): Agent | null => state.agentsById[id] ?? null;
}

export function selectAgentSummaries(state: AppState): AgentSummary[] {
  return state.agentIds
    .map((id) => state.agentsById[id])
    .filter((agent): agent is Agent => Boolean(agent))
    .map((agent) => ({
      id: agent.id,
      projectId: agent.projectId ?? null,
      projectLabel: agent.project?.name || agent.projectPath,
      status: agent.status,
    }));
}
