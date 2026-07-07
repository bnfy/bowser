@platform-services
Feature: Platform services — telemetry, updates, zoom, autofill
  The features whose observable behaviour legitimately differs by platform, so the
  scenarios carry platform tags instead of @all.

  @F21-1 @F21 @all
  Scenario: The usage ping is off by default and single when enabled
    Given this is a packaged build
    And the usage ping setting is off
    When the app launches
    Then no usage ping is sent
    When I enable the usage ping
    And the app launches
    Then exactly one anonymous usage ping is sent

  @F22-1 @F22 @desktop @D9
  Scenario: Desktop updates through the in-app updater
    Given a newer release is available
    Then the app can update itself through the in-app updater

  @F22-2 @F22 @mobile @D9
  Scenario: Mobile ships no self-updater
    Then the build contains no in-app self-updater
    And updates are delivered through the app store

  @F23-1 @F23 @all @D10
  Scenario: A page can be scaled and reset
    When I enlarge the page through the platform's zoom control
    Then the page content is enlarged
    When I reset the zoom
    Then the page returns to its default scale

  @F24-1 @F24 @mobile @D12
  Scenario: Saved credentials and passkeys work in a tab
    Given saved credentials exist for "login.example"
    When I focus the login form on "login.example"
    Then the system offers to fill the saved credentials
    When I complete a passkey sign-in
    Then the platform authenticator is invoked
</content>
