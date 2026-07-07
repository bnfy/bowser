@tabs
Feature: Tabs and tab groups
  Tab lifecycle and the named-group model. Groups have names not colors, exist
  only while non-empty, and the pill renders only the active group.

  @F2-1 @F2 @all
  Scenario: Reopen closed tab restores the last-closed URL
    Given a tab open on "a.example"
    When I close that tab
    And I reopen the last closed tab
    Then a tab open on "a.example" is present

  @F2-2 @F2 @all
  Scenario: Duplicate tab
    Given the active tab is on "b.example"
    When I duplicate the active tab
    Then a second tab open on "b.example" is present

  @F2-3 @F2 @all
  Scenario: Pinning a tab orders it ahead of unpinned tabs
    Given tabs open on "one.example" and "two.example"
    When I pin "two.example"
    Then "two.example" is marked pinned
    And "two.example" is ordered before "one.example"

  @F2-4 @F2 @all
  Scenario: A plain new tab opens ungrouped
    Given the active tab is in a group named "work"
    When I open a new tab
    Then the new tab has no group
    And the new tab is on the new-tab page

  @F3-1 @F3 @all
  Scenario: Creating a group moves the active tab into it
    Given the active tab has no group
    When I run the slash command "/group work"
    Then a group named "work" exists
    And the active tab is in "work"

  @F3-2 @F3 @all
  Scenario: The pill renders only the active group
    Given a group "work" with 2 tabs
    And a group "play" with 2 tabs
    When the active tab is in "work"
    Then the island shows the group name "work"
    And the island does not show the group name "play"

  @F3-3 @F3 @all
  Scenario: Collapsing a group tucks its tabs away in the panel
    Given a group "work" with 3 tabs
    When I open the command palette
    And I collapse the group "work"
    Then the panel shows a "3 tabs tucked away" row for "work"

  @F3-4 @F3 @all
  Scenario: Removing a group's last tab prunes the group
    Given a group "solo" with 1 tab
    When I close the last tab in "solo"
    Then the group "solo" no longer exists
</content>
