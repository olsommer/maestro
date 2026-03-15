"use client";

import { create } from "zustand";
import type { Agent, Project } from "./api";

interface AppState {
  agents: Agent[];
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

export const useStore = create<AppState>((set) => ({
  agents: [],
  projects: [],
  selectedAgentId: null,
  selectedProjectId: null,

  setAgents: (agents) => set({ agents }),
  setProjects: (projects) =>
    set((state) => ({
      projects,
      selectedProjectId:
        state.selectedProjectId && projects.some((p) => p.id === state.selectedProjectId)
          ? state.selectedProjectId
          : projects[0]?.id ?? null,
    })),

  updateAgent: (id, patch) =>
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === id ? { ...a, ...patch } : a
      ),
    })),
  updateProject: (id, patch) =>
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === id ? { ...project, ...patch } : project
      ),
    })),

  addAgent: (agent) =>
    set((state) => ({
      agents: [agent, ...state.agents],
    })),
  addProject: (project) =>
    set((state) => ({
      projects: [project, ...state.projects],
      selectedProjectId: project.id,
    })),

  removeAgent: (id) =>
    set((state) => ({
      agents: state.agents.filter((a) => a.id !== id),
      selectedAgentId: state.selectedAgentId === id ? null : state.selectedAgentId,
    })),
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
