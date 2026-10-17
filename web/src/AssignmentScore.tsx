import { type Score, pointsText, percentText } from "./core/model";

// Follow native AssignmentRow: numeric scores take precedence over a letter,
// while excused work retains its status even when a local score is entered.
export function AssignmentScore({
  score,
  override,
}: {
  score: Score;
  override?: number;
}) {
  if (score.excused) return <span className="score-label">Excused</span>;
  const earned = override ?? score.earned;
  if (earned === undefined)
    return <span className="score-label">{score.letter || "—"}</span>;
  const percent =
    (score.possible ?? 0) > 0 ? (earned / score.possible!) * 100 : undefined;
  return (
    <>
      <strong>
        {pointsText(earned)}/{pointsText(score.possible)}
      </strong>
      <small>{percentText(percent)}</small>
    </>
  );
}
