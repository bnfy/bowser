@vertical-tabs
Feature: Desktop vertical tabs
  The optional desktop rail is a live presentation of the canonical tab model.
  It reserves the page pane without replacing the Island, reloading tabs, or
  turning remote-device snapshots into local rows. Mobile uses its native tab
  overview under D19.

  @F28-1 @F28 @desktop @D19
  Scenario: The layout defaults to Island, persists locally, and never syncs
    Given a fresh desktop settings profile
    Then the tab layout is "island"
    When I set the tab layout to "vertical"
    And I relaunch Blanc
    Then the tab layout is "vertical"
    And the vertical tab rail is shown
    And the Profile Sync payload does not contain the tab-layout preference
    When Profile Sync receives a different tab-layout preference
    Then the tab layout remains "vertical"

  @F28-2 @F28 @desktop @D19
  Scenario: Changing tab layout does not reload guest content
    Given an active web tab with a load counter and unsaved in-page state
    When I change the tab layout from "island" to "vertical"
    And I change the tab layout from "vertical" to "island"
    Then the same tab WebContents remains alive
    And its load counter has not increased
    And its unsaved in-page state is unchanged

  @F28-3 @F28 @desktop @D19
  Scenario: Guest content and the utility sheet use the vertical page pane
    Given a 1000 by 700 desktop window with the vertical tab layout
    When an ordinary tab is active below the 64 pixel strip
    Then its guest bounds are x 248, y 64, width 752, height 636
    And the resting Island is centered over the page pane
    When I open a utility page
    Then its sheet bounds are x 248, y 64, width 752, height 636
    And the rail remains visible and unobscured

  @F28-4 @F28 @desktop @D19
  Scenario: Panel and palette exclude the rail while expanding from the strip
    Given a 1000 by 700 desktop window with the vertical tab layout
    When I open the Island panel
    Then the panel overlay bounds are x 248, y 0, width 752, height 700
    And the expanded Island is centered over the page pane
    When I replace the panel with the command palette
    Then the palette overlay bounds are x 248, y 0, width 752, height 700
    And the expanded Island remains centered over the page pane

  @F28-5 @F28 @desktop @D19
  Scenario: Find remains inside the page pane at the minimum window size
    Given a 640 by 480 desktop window with the vertical tab layout
    Then the page pane starts at x 248 and is 392 pixels wide
    When I open find in page
    Then the visible find capsule is centered in the page pane
    And the visible find capsule is no wider than 368 pixels
    And the find capsule does not overlap the vertical tab rail

  @F28-6 @F28 @desktop @D19
  Scenario: The rail preserves canonical buckets, groups, and remote-tab scope
    Given the local tab model contains ungrouped pins, named groups, and loose tabs
    And one named group contains both pinned and unpinned tabs
    And another device has shared open tabs
    When the vertical tab rail is shown
    Then ungrouped pinned rows appear first
    And each named group follows in canonical group order
    And pinned rows lead unpinned rows inside each group
    And loose ungrouped rows follow the named groups
    And the new-tab action is last
    And remote-device tabs do not appear in the rail
    But remote-device tabs remain available in the Quick Switcher and start page
    When I fold the group containing the active tab
    Then its group header exposes the collapsed-active state
    And I can unfold that group from its header

  @F28-7 @F28 @desktop @D19
  Scenario: Rail rows expose identity, privacy, loading, pin, and audio states
    Given local tabs cover active, loading, private, pinned, audible, and muted states
    When the vertical tab rail is shown
    Then every rail row exposes its favicon and title
    And the active row is identified
    And the loading row exposes loading state
    And the private row exposes private state
    And the pinned row exposes pinned state
    And audible and muted rows expose distinct audio states
    And those states have accessible names that do not rely on color alone

  @F28-8 @F28 @desktop @D19
  Scenario: Rail pointer actions switch, close, create, and retain menu actions
    Given three local tabs are visible in the vertical tab rail
    When I activate an inactive tab row
    Then that tab becomes active without being duplicated
    When I use the row close action on another tab
    Then that tab closes
    When I middle-click a remaining tab row
    Then that tab closes
    When I activate the rail new-tab action
    Then a new ungrouped tab opens on the new-tab page
    And pin, mute, duplicate, and group-membership actions remain available through the Island or native menus

  @F28-9 @F28 @desktop @D19
  Scenario: Activating any rail row dismisses transient chrome and focuses content
    Given a local tab row is already active in the vertical tab rail
    When I activate that row with the panel, palette, find capsule, or utility sheet open
    Then the open transient surface is dismissed
    And the tab is activated at most once
    And focus moves to the active tab content
    When I activate an inactive row with a transient surface open
    Then the open transient surface is dismissed
    And that tab becomes active at most once
    And focus moves to that tab's content

  @F28-10 @F28 @desktop @D19
  Scenario: Drag reorder succeeds inside one group and pin bucket
    Given three rail rows share the same group and pinned state
    When I drag the third row before the first row
    Then the canonical tab order reflects that move
    And every row keeps its group and pinned state
    When I drag the first row to the end of that source bucket
    Then the reorder request uses no before-row id
    And the canonical tab order places it at that bucket's end

  @F28-11 @F28 @desktop @D19
  Scenario: Drag reorder rejects cross-bucket drops
    Given rail rows span different groups and pinned states
    When I drag a row across a group boundary
    Then the drop is rejected
    And canonical tab order and group membership are unchanged
    When I drag a pinned row into an unpinned bucket
    Then the drop is rejected
    And canonical tab order and pinned state are unchanged

  @F28-12 @F28 @desktop @D19
  Scenario: Keyboard focus roves through primary rows and accessible actions
    Given primary rail-row focus is on the active tab
    When I press ArrowDown or ArrowUp
    Then primary focus moves to the adjacent visible row without switching tabs
    When I press End
    Then primary focus moves to the last visible row
    When I press Home
    Then primary focus moves to the first visible row
    When I press Enter or Space
    Then the focused row becomes active
    When I move focus to its sibling close action
    Then the close action has a visible focus indicator and an accessible label
    When I press Escape from the rail
    Then focus returns to the active tab content
