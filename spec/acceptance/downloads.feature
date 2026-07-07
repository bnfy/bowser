@downloads
Feature: Downloads
  The downloads list UI, progress, and states are identical across platforms;
  where the file lands and how it re-opens diverges (D3).

  @F11-1 @F11 @all
  Scenario: A download shows progress and completes
    When I start a download
    Then a downloads row shows progress
    And the row reaches a completed state

  @F11-2 @F11 @all @D3
  Scenario: A completed download is retrievable
    Given a completed download
    When I open the completed download
    Then the file opens through the platform's normal file mechanism
</content>
