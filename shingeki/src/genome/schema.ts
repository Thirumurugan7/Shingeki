export interface Genome {
  id: string;
  model: string;
  strategy: string;
  tools: string[];
  reflection_depth: number;
  mutation_rate: number;
}

export interface AgentMeshConfig {
  agent: { name: string; strategy: string };
  genome: Omit<Genome, 'id'>;
  mesh: { min_nodes: number };
}

export function genomeFromConfig(cfg: AgentMeshConfig, id = 'genome-v1'): Genome {
  return {
    id,
    model: cfg.genome.model,
    strategy: cfg.agent.strategy,
    tools: [...cfg.genome.tools],
    reflection_depth: cfg.genome.reflection_depth,
    mutation_rate: cfg.genome.mutation_rate,
  };
}
