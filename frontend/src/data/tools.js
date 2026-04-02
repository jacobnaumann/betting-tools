export const TOOL_DEFINITIONS = [
  {
    id: 'odds-converter',
    name: 'Odds Converter',
    description: 'Convert American and Decimal odds with implied probability.',
    path: '/tools/odds-converter',
    category: 'Calculator',
  },
  {
    id: 'bet-size',
    name: 'Bet Size Calculator',
    description: 'Flat, bankroll percentage, and Kelly-based stake sizing.',
    path: '/tools/bet-size',
    category: 'Calculator',
  },
  {
    id: 'parlay',
    name: 'Parlay Builder',
    description: 'Combine leg prices to estimate total odds and payout.',
    path: '/tools/parlay',
    category: 'Builder',
  },
  {
    id: 'quick-notes',
    name: 'Quick Notes',
    description: 'Capture short betting notes by game, team, or angle.',
    path: '/tools/quick-notes',
    category: 'Notebook',
  },
  {
    id: 'overlay-calculator',
    name: 'Overlay Calculator',
    description: 'Calculate total overlay and per-player overlay value.',
    path: '/tools/overlay-calculator',
    category: 'Calculator',
  },
  {
    id: 'round-leader-projection',
    name: 'Round Leader Projection',
    description: 'Project final round score using live leaderboard and hole scoring data.',
    path: '/tools/round-leader-projection',
    category: 'Projection',
  },
  {
    id: 'probability-calculator',
    name: 'Probability Calculator',
    description: 'Combine independent event probabilities to estimate all-events occurrence.',
    path: '/tools/probability-calculator',
    category: 'Calculator',
  },
  {
    id: 'basketball-modeling',
    name: 'Basketball Modeling',
    description: 'Build custom pools, engineer features, train ridge models, and predict matchups.',
    path: '/tools/basketball-modeling',
    category: 'Modeling',
  },
];

export function getToolById(toolId) {
  return TOOL_DEFINITIONS.find((tool) => tool.id === toolId);
}
