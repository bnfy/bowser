@find @favorites @history
Feature: Find in page, favorites, and history
  Find-in-page, the Favorites feature (internal id stays "bookmarks"), and the
  capped, private-excluded history.

  @F8-1 @F8 @all
  Scenario: Find shows a match count and keeps the page interactive
    Given a page containing the word "widget" 3 times
    When I open find in page
    And I search for "widget"
    Then the match count shows 3
    And I can navigate to the next and previous match
    And the page content outside the find bar remains clickable

  @F9-1 @F9 @all
  Scenario: Favoriting the active page surfaces it on newtab and the favorites list
    Given the active tab is on "keep.example"
    When I add the active page to favorites
    Then the favorite control shows as active
    And "keep.example" appears on the new-tab page
    And "keep.example" appears on the favorites page

  @F9-2 @F9 @all
  Scenario: Add all open tabs to favorites
    Given tabs open on "one.example" and "two.example"
    When I add all open tabs to favorites
    Then "one.example" appears on the favorites page
    And "two.example" appears on the favorites page

  @F10-1 @F10 @all
  Scenario: A visit is recorded with the final page title
    When I visit "read.example" with title "Reader"
    Then history contains one entry for "read.example" titled "Reader"

  @F10-2 @F10 @all
  Scenario: Clearing history empties the list
    Given history has at least one entry
    When I run the slash command "/clear"
    Then history is empty
</content>
