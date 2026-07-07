@supporter @session
Feature: Supporter colorways and session restore
  Cosmetic supporter colorways (trusted-forever, offline-OK) and session restore
  that preserves groups but never private tabs.

  @F17-1 @F17 @all @D6
  Scenario: An active supporter unlock enables the supporter colorways
    Given an active supporter unlock
    When I choose the app icon "ember"
    Then the app icon "ember" is applied

  @F17-2 @F17 @all
  Scenario: Non-supporters cannot use supporter colorways
    Given there is no active supporter license
    Then the supporter colorways are shown as locked
    And selecting one leaves the app icon at "paper"

  @F18-1 @F18 @all @D8
  Scenario: Relaunch restores groups but not private tabs
    Given a group "work" with 2 tabs
    And a group "play" with 1 tab
    And one private tab open
    When I relaunch the app
    Then the group "work" is restored with its 2 tabs
    And the group "play" is restored with its 1 tab
    And no private tab is restored
</content>
