import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";

interface StopRunButtonProps {
  className?: string;
  disabled?: boolean;
  onClick: () => void;
  /** A stop request is in flight: the button stays disabled and shows progress. */
  stopping?: boolean;
}

/**
 * The visible "cancel the run" affordance for a pending-interaction card. The
 * card swaps out the composer, so the composer's own stop button is not on
 * screen while an approval or question blocks the turn — without this entry a
 * stuck interaction could only be cleared through the stop route by hand.
 */
export function StopRunButton({
  className,
  disabled = false,
  onClick,
  stopping = false,
}: StopRunButtonProps) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className={className}
      disabled={disabled || stopping}
      onClick={onClick}
    >
      {stopping ? (
        <Icon name="Spinner" className="size-3 animate-spin" />
      ) : (
        <Icon name="Square" className="size-3 fill-current [&_*]:stroke-0" />
      )}
      {stopping ? "Stopping run..." : "Stop run"}
    </Button>
  );
}
