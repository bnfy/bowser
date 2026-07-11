@private
Feature: Private tabs
  Private tabs are never recorded locally, inherit privacy to children, and use
  a non-persistent web session isolated from ordinary tabs.

  @F4-1 @F4 @all
  Scenario: Private browsing is not recorded and cannot be reopened
    Given I open a private tab
    When I visit "secret.example" in the private tab
    Then "secret.example" is not in history
    When I close the private tab
    And I reopen the last closed tab
    Then no tab open on "secret.example" is restored

  @F4-2 @F4 @all
  Scenario: Private chrome styling and quick exit
    Given the active tab is private
    Then the island uses the private theme
    And the island shows a "private" chip
    When I activate the "private" chip
    Then the private tab closes

  @F4-3 @F4 @all
  Scenario: Child tabs inherit privacy
    Given the active tab is private
    When a link in the page opens a new tab
    Then the new tab is private

  @F4-4 @F4 @all
  Scenario: Private tabs use an isolated in-memory web session
    Given the active tab is private
    Then the private tab uses a different web session from ordinary tabs

  @F4-5 @F4 @all
  Scenario: A private new tab actually loads its start page
    Given the active tab is private
    Then the private tab's start page loads in the non-persistent session

  @F4-6 @F4 @desktop @D16
  Scenario: Passkeys created in a private tab are ephemeral
    Given the active tab is private
    When I register a device-bound passkey on a site in the private tab
    And Blanc quits and relaunches
    Then that passkey is no longer offered on the site
