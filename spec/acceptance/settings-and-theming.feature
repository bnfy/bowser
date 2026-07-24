@settings @theming
Feature: Settings and theming
  Settings validation (shared schema + sanitize-on-read == validate-on-write) and
  live theme propagation to chrome, internal pages, and web content.

  @F14-1 @F14 @all
  Scenario: An invalid search engine is rejected
    When I attempt to set the search engine to "askjeeves"
    Then the search engine remains unchanged

  @F14-2 @F14 @all @D5
  Scenario: A supporter icon without a license falls back to the default
    Given there is no active supporter license
    When settings contain the app icon "ember"
    Then the effective app icon is "paper"

  @F14-3 @F14 @all
  Scenario: Exception hostnames are normalized
    When I add "WWW.Example.com/x" to the ad-block exceptions
    Then the ad-block exceptions contain "example.com"
    And the ad-block exceptions do not contain "www.example.com"

  @F14-4 @F14 @all
  Scenario: Search suggestions can be disabled without syncing the preference
    When I turn search suggestions off
    Then search suggestions are disabled
    And the search-suggestions preference remains device-local

  @F15-1 @F15 @all
  Scenario: Switching to dark recolors chrome and internal pages live
    Given an internal blanc page is open
    When I set the theme to "dark"
    Then the chrome uses the dark palette
    And the open internal page uses the dark palette
    And no restart was required

  @F15-2 @F15 @all
  Scenario: Private tabs use the private theme scope
    When the active tab is private
    Then the chrome uses the private palette
