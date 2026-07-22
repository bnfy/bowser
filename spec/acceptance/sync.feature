@sync
Feature: Tab sync (open tabs from other devices)
  Other devices' open tabs are browsable read-only via E2EE profile sync;
  publishing is per-device opt-in and off by default.

  @F27-1 @F27 @all
  Scenario: Sharing open tabs is off by default
    Given sync is enabled on this device
    Then the "share this device's open tabs" setting is off
    And no tab snapshot for this device is published

  @F27-2 @F27 @all
  Scenario: A remote device's tab opens locally as a new ungrouped tab
    Given a synced device "MacBook Air" with 3 shared tabs
    When I open the palette and unfold "MacBook Air"
    And I choose its first remote tab
    Then it opens as a new ungrouped local tab

  @F27-3 @F27 @all
  Scenario: Turning sharing off retracts this device's tabs
    Given sharing open tabs is on and synced
    When I turn sharing off
    Then other devices no longer list this device
