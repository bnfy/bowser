@navigation
Feature: Address input, search, and link handling
  The address heuristic, search-engine routing, OS hand-off for non-web URIs,
  and context-menu link actions.

  @F5-1 @F5 @all
  Scenario: Typing a domain navigates
    When I enter "example.com" in the command bar
    Then the active tab navigates to "example.com"

  @F5-2 @F5 @all
  Scenario Outline: Typing a query searches with the selected engine
    Given the search engine is "<engine>"
    When I enter "how tall is everest" in the command bar
    Then the active tab navigates to a "<engine>" search for "how tall is everest"

    Examples:
      | engine     |
      | duckduckgo |
      | google     |
      | bing       |
      | brave      |

  @F5-3 @F5 @all @D4
  Scenario: A mailto URI is handed to the OS
    When I enter "mailto:a@b.com" in the command bar
    Then the OS mail handler is invoked
    And no tab treats "mailto:a@b.com" as a search query

  @F19-1 @F19 @all @D4 @D7
  Scenario: Open link in a background tab inherits the opener's group
    Given the active tab is in a group named "work"
    When I open the context menu on a link
    And I choose "Open link in background tab"
    Then a new tab opens on that link without switching to it
    And the new tab is in the group "work"
</content>
