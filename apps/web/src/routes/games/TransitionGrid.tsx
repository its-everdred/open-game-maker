import { Component, type KeyboardEventHandler, type ReactNode, type RefObject } from 'react';

type Props = {
  children: ReactNode;
  gridRef: RefObject<HTMLDivElement | null>;
  selectedId: string | null;
  order: readonly unknown[];
  onSnapshot(): void;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
};

// Capture the currently visible geometry before React moves either card's cover.
export class TransitionGrid extends Component<Props> {
  getSnapshotBeforeUpdate(previous: Props): null {
    if (previous.selectedId !== this.props.selectedId || previous.order !== this.props.order) this.props.onSnapshot();
    return null;
  }

  componentDidUpdate(): void {}

  render() {
    return (
      <div
        ref={this.props.gridRef}
        className="games-grid"
        role="grid"
        aria-label="Your games"
        onKeyDown={this.props.onKeyDown}
      >
        {this.props.children}
      </div>
    );
  }
}
