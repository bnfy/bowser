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
    When I follow its "History" navigation link
    Then the history page opens under the blanc scheme
</content>
