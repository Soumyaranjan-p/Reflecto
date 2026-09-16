import fs from "node:fs";
import path from "node:path";
import { app, globalShortcut } from "electron";
import { Action, setShortcutBinding, toAccelerator, effectiveShortcut, defaultShortcut, findShortcutConflict } from "../shortcuts";
import { HistoryStore } from "../history/store";
import { getPref, setPref } from "../preferences";
import { shouldPresentOnboarding, markOnboardingSeen } from "../onboarding/window";

export async function runAppE2E(): Promise<string> {
  const reportPath = path.join(app.getPath("userData"), "app-e2e.json");
  const report: Record<string, unknown> = { startedAt: new Date().toISOString() };

  const desired = { keyCode: 0x4b, modifiers: 2 | 4, enabled: true }; // Ctrl+Shift+K
  const conflictProbe = defaultShortcut(Action.fullscreen);
  report.shortcutConflict = conflictProbe
    ? findShortcutConflict(Action.region, conflictProbe)
    : null;
  const setOk = setShortcutBinding(Action.openSettings, desired);
  report.shortcutSet = setOk;
  const accel = toAccelerator(desired);
  report.shortcutRegistered = globalShortcut.isRegistered(accel);
  report.shortcutStored = effectiveShortcut(Action.openSettings);
  setShortcutBinding(Action.openSettings, defaultShortcut(Action.openSettings));

  const tmp = path.join(app.getPath("userData"), "library", `e2e-gallery-${Date.now()}.png`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ));
  const rec = HistoryStore.shared.importCapture(tmp, false, "screenshot");
  const share = "https://example.invalid/share/e2e-keep";
  if (rec) HistoryStore.shared.setShareURL(HistoryStore.shared.urlForRecord(rec), share);
  const fresh = rec ? HistoryStore.shared.records.find((r) => r.id === rec.id) ?? rec : null;
  const filePath = fresh ? HistoryStore.shared.urlForRecord(fresh) : tmp;
  report.galleryBefore = { id: fresh?.id, exists: fs.existsSync(filePath), shareURL: fresh?.shareURL };
  const del = fresh ? await HistoryStore.shared.deleteRecord(fresh) : { trashed: false, keptShare: null };
  const after = rec ? HistoryStore.shared.records.find((r) => r.id === rec.id) : null;
  report.galleryDelete = {
    ...del,
    fileExistsAfter: fs.existsSync(filePath),
    recordKept: Boolean(after),
    shareAfter: after?.shareURL ?? null,
    localDeleted: after?.localDeleted ?? null,
  };

  const previous = getPref("onboardingSeenVersion");
  setPref("onboardingSeenVersion", 0);
  const first = shouldPresentOnboarding();
  markOnboardingSeen();
  const second = shouldPresentOnboarding();
  report.onboarding = { previous, firstLaunch: first, afterMarkSeen: second, seenVersion: getPref("onboardingSeenVersion") };
  if (previous !== 0) setPref("onboardingSeenVersion", previous);

  report.ok = Boolean(setOk.ok)
    && report.shortcutRegistered === true
    && del.trashed === true
    && report.galleryDelete && (report.galleryDelete as { fileExistsAfter: boolean }).fileExistsAfter === false
    && (report.galleryDelete as { shareAfter: string }).shareAfter === share
    && first === true
    && second === false;
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log("[Reflecto:app-e2e]", JSON.stringify(report, null, 2));
  return reportPath;
}
