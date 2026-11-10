import './ai-badge.css';

export function withAiGeneratedLabel(label: string, aiGenerated: boolean | undefined): string {
  return aiGenerated ? `${label}, AI-generated` : label;
}

export function AiBadge() {
  return (
    <span className="ai-badge" aria-label="AI-generated">
      AI
    </span>
  );
}
