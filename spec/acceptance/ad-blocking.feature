@adblock
Feature: Ad and tracker blocking
  The user-facing contract is identical across platforms; the engine diverges
  (D1: WKContentRuleList on iOS vs programmatic interception on Android/desktop)
  and the per-site exception mechanism diverges (D2). Neither is observable in
  these scenarios — that is the point.

  Background:
    Given ad/tracker blocking is enabled

  @F12-1 @F12 @all @D1
  Scenario: Blocking increments the per-tab shield count
    When I load a page that requests known trackers
    Then the shield count for the tab is greater than 0

  @F12-2 @F12 @all @D2
  Scenario: Allowing ads on a site drops its shield count and persists
    Given the active tab is on "ads.example" with a shield count greater than 0
    When I run the slash command "/allow-ads"
    Then the shield count for "ads.example" becomes 0
    And "ads.example" is in the ad-block exceptions
    When I reload "ads.example"
    Then ads are still allowed on "ads.example"

  @F12-3 @F12 @all
  Scenario: The global toggle turns blocking off and on
    When I run the slash command "/block-ads"
    Then ad/tracker blocking is disabled
    When I run the slash command "/block-ads"
    Then ad/tracker blocking is enabled
</content>
