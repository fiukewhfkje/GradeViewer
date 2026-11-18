import {
  type Score,
  pointsText,
  percentText,
  scenarioScore,
} from "./core/model";

// Follow native AssignmentRow: numeric scores take precedence over a letter,
// while excused work retains its status even when a local score is entered.
export function AssignmentScore({
  score,
  override,
  possibleOverride,
}: {
  score: Score;
  override?: number;
  possibleOverride?: number;
}) {
  if (score.excused) return <span className="score-label">Excused</span>;
  const { earned, possible } = scenarioScore(score, override, possibleOverride);
  if (earned === undefined)
    return <span className="score-label">{score.letter || "—"}</span>;
  const percent =
    possible !== undefined && possible > 0
      ? (earned / possible) * 100
      : undefined;
  return (
    <>
      <strong>
        {pointsText(earned)}/{pointsText(possible)}
      </strong>
      <small>{percentText(percent)}</small>
    </>
  );
}
