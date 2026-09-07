/**
 * The composer seat, while the team world is on screen.
 *
 * A conversation view tab cannot reach the composer on its own — the composer
 * chain's selectors never see which view is active — so the plugin body puts
 * this entry on the chain for exactly as long as a stage is mounted. Winning
 * the election hides the whole composer stack (the card, its docks and the
 * stats line) without touching one node of the host tree, and the marker
 * attribute hands the freed height to the view: the world gets the tab, and the
 * reader gets its input back the moment it opens another tab.
 */
import css from './TeamStage.module.css'

/** The empty composer: a zero-height marker where the input card would be. */
export function ComposerAway() {
  return <span className={css.composerAway} data-conversation-composer-overlay aria-hidden />
}
