@island
Feature: Island chrome, command palette, and slash commands
  The single custom command surface: the resting pill, the expanded command
  palette with the Quick Switcher, and slash commands. Steps are intent-level;
  each platform binds them to its native trigger (D7) and windowing (D11).

  Background:
    Given ad/tracker blocking is enabled

  @F1-1 @F1 @all
  Scenario: The resting pill reflects the active tab, group, and shield
    Given a group named "work" with 3 tabs
    And the active tab is in "work" on a page where 2 requests were blocked
    When the island is at rest
    Then the island shows back and forward controls
    And the island shows 3 group dots
    And the island shows the group name "work"
    And the island shows the active page's domain
    And the island shows a shield count of 2
    And the island shows the trailing action cluster

  @F1-2 @F1 @all
  Scenario: Opening the palette floats the command bar with the tab switcher
    Given 2 tabs are open
    When I open the command palette
    Then the command bar is shown over the page content
    And the list area shows the tab switcher

  @F6-1 @F6 @all
  Scenario: The Quick Switcher matches open tabs and favorites
    Given a tab open on "news.example"
    And a favorite for "docs.example"
    When I open the command palette
    And I type "exa"
    Then the results include the tab "news.example"
    And the results include the favorite "docs.example"

  @F6-2 @F6 @all
  Scenario: The Quick Switcher matches a group name and focuses it
    Given a group named "research" with 2 tabs that is not active
    When I open the command palette
    And I type "research"
    Then a group result "research" is listed above any tab results
    When I choose the group result "research"
    Then the active tab is one of the tabs in "research"

  @F7-1 @F7 @all
  Scenario: A slash prefix filters the command list
    When I open the command palette
    And I type "/gr"
    Then the command "/group" is listed
    And the command "/history" is not listed

  @F7-2 @F7 @all
  Scenario Outline: Running a slash command performs its action
    When I open the command palette
    And I run the slash command "<command>"
    Then <outcome>

    Examples:
      | command    | outcome                                          |
      | /new       | a new ungrouped tab opens on the new-tab page     |
      | /downloads | the downloads page opens                          |
      | /find      | the find bar is shown                             |
</content>
