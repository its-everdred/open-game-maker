export function AnsweredReviewCard({
  title,
  summary,
  onClick,
}: {
  title: string;
  summary: string;
  onClick?: () => void;
}) {
  return onClick ? (
    <button type="button" className="worker-review-answered" onClick={onClick}>
      <strong>{title}</strong>
      <span>{summary}</span>
    </button>
  ) : (
    <div className="worker-review-answered">
      <strong>{title}</strong>
      <span>{summary}</span>
    </div>
  );
}
