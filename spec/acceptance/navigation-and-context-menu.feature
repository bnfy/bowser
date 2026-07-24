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

  @F5-4 @F5 @all
  Scenario: Autocomplete follows the current default search engine
    Given the autocomplete provider returns "blanc browser release notes"
    And the search engine is "google"
    When I type "blanc browser probe" in the autocomplete palette
    Then autocomplete requests "blanc browser probe" from "google"
    And the completion "blanc browser release notes" is shown
    When the search engine is "brave"
    And I submit the command-bar text
    Then the search submission uses "brave" for "blanc browser probe"

  @F5-5 @F5 @all
  Scenario: Autocomplete keeps opted-out, private, and pasted text local
    Given the autocomplete provider returns "should never appear"
    When I turn search suggestions off
    And I type "opted out autocomplete probe" in the autocomplete palette
    Then the autocomplete provider has not received a request
    When I turn search suggestions on
    And the active tab is private
    And I type "private autocomplete probe" in the autocomplete palette
    Then the autocomplete provider has not received a request
    When I open a new tab
    And I paste "confidential quarterly notes" into the autocomplete palette
    And I delete the command-bar text
    And I undo the command-bar deletion
    Then the autocomplete provider has not received a request

  @F19-1 @F19 @all @D4 @D7
  Scenario: Open link in a background tab inherits the opener's group
    Given the active tab is in a group named "work"
    When I open the context menu on a link
    And I choose "Open link in background tab"
    Then a new tab opens on that link without switching to it
    And the new tab is in the group "work"
