@internal-pages
Feature: Internal blanc:// pages
  The newtab "ledger" start page and the privileged internal scheme. Best shipped
  as one shared web bundle so these stay pixel-identical (substrate S4).

  @F16-1 @F16 @all
  Scenario: The new-tab ledger shows the day, favorites, groups, and blocked count
    Given at least one favorite and one resumable group exist
    When I open a new tab
    Then the new-tab page shows today's date
    And it shows the favorites section
    And it shows resumable tab groups
    And it shows the weekly blocked count
    And it shows no mascot

  @F16-2 @F16 @all
  Scenario: Internal navigation stays within the blanc scheme
    Given the new-tab page is open
    When I follow its "Favorites" navigation link
    Then the favorites page opens in the utility sheet under the blanc scheme
    And no new tab is created

  @F16-4 @F16 @all
  Scenario: Utility pages never occupy tabs
    Given a tab open on "site.example"
    When I open the downloads page
    Then the downloads page opens in the utility sheet
    And the active tab and tab order are unchanged

  @F16-5 @F16 @all
  Scenario: Activating a favorite from the utility sheet opens one real tab
    Given a favorite for "kept.example" exists
    And the favorites page is open in the utility sheet
    When I activate that favorite
    Then exactly one new tab opens on "kept.example"
    And the utility sheet is dismissed

  @F16-6 @F16 @all
  Scenario: Untrusted web content cannot summon the utility sheet
    Given a tab open on untrusted web content
    When the page navigates itself to the settings page
    Then the utility sheet remains closed
    When the page window-opens the settings page
    Then the utility sheet remains closed

  @F16-7 @F16 @desktop
  Scenario: Re-invoking the shown utility page toggles it closed regardless of URL spelling
    Given the settings page is open in the utility sheet via a typed address
    When the settings page is invoked again by the menu
    Then the utility sheet is dismissed

  @F16-3 @F16 @desktop
  Scenario: Privileged browser chrome cannot navigate to web content
    When browser chrome attempts to navigate to "https://example.com"
    Then browser chrome remains on its trusted local document
