@platform-services
Feature: Platform services — telemetry, updates, zoom, autofill
  The features whose observable behaviour legitimately differs by platform, so the
  scenarios carry platform tags instead of @all.

  @F21-1 @F21 @all
  Scenario: A fresh profile sends nothing before its usage-ping choice is committed
    Given this is a packaged build with a fresh profile
    When the app launches
    Then no usage ping is sent
    When I commit the enabled usage ping choice
    Then exactly one launch ping is sent
    And it contains only an install id, session id, version, platform, and architecture
    And it contains no browsing data

  @F21-2 @F21 @all
  Scenario: Declining the usage ping persists without minting an install id
    Given this is a packaged build with a fresh profile
    When I commit the disabled usage ping choice
    And the app launches again
    Then no usage ping is sent
    And no telemetry install id exists

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
