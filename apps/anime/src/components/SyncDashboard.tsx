"use client";

import CheckIcon from "@mui/icons-material/Check";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import WarningIcon from "@mui/icons-material/Warning";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { enqueueSnackbar } from "notistack";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import KitsuSyncButton from "@/components/KitsuSyncButton";
import type { SyncLog } from "@/generated/prisma/client";
import {
  deleteInvalidEntriesAction,
  findInvalidEntriesAction,
  getSyncStatusAction,
  normalizeInvalidRatingsAction,
  triggerSyncAction,
} from "@/lib/actions";
import type {
  InvalidEntriesResult,
  SyncStatusPayload,
} from "@/lib/actions/sync";
import { repairMissingKitsuMappings } from "@/lib/kitsu/client-mapping-repair";

const PROVIDER_LABELS = { KITSU: "Kitsu", ANILIST: "AniList" } as const;

export default function SyncDashboard() {
  const [data, setData] = useState<SyncStatusPayload | null>(null);
  const [running, setRunning] = useState<string | null>(null); // "KITSU-PULL" etc.
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [expandedRecent, setExpandedRecent] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [invalidModalOpen, setInvalidModalOpen] = useState(false);
  const [invalidData, setInvalidData] = useState<InvalidEntriesResult | null>(
    null,
  );
  const [loadingInvalid, setLoadingInvalid] = useState(false);
  const [hasInvalidEntries, setHasInvalidEntries] = useState(false);
  const [selectedAnimeIds, setSelectedAnimeIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedMangaIds, setSelectedMangaIds] = useState<Set<string>>(
    new Set(),
  );

  const fetchStatus = useCallback(async () => {
    try {
      setData(await getSyncStatusAction());
    } catch {
      // ignore transient errors
    }
  }, []);

  const checkForInvalidEntries = useCallback(async () => {
    try {
      const result = await findInvalidEntriesAction();
      setHasInvalidEntries(
        result.invalidAnime.length > 0 || result.invalidManga.length > 0,
      );
    } catch {
      // ignore transient errors
    }
  }, []);

  // Initial load + poll while something is running
  useEffect(() => {
    fetchStatus();
    checkForInvalidEntries();
  }, [fetchStatus, checkForInvalidEntries]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(fetchStatus, 2000);
    return () => clearInterval(id);
  }, [running, fetchStatus]);

  async function triggerSync(
    provider: "KITSU" | "ANILIST",
    direction: "PULL" | "PUSH",
  ) {
    setRunning(`${provider}-${direction}`);
    try {
      const result = await triggerSyncAction(provider, direction);
      if (!result.ok) {
        enqueueSnackbar(result.error, { variant: "error" });
        return;
      }

      if (provider === "ANILIST" && direction === "PULL") {
        try {
          const repair = await repairMissingKitsuMappings();
          const repairedKitsu = repair.repairedAnime + repair.repairedManga;
          const repairedAniList =
            repair.repairedAniListAnime + repair.repairedAniListManga;
          if (repairedKitsu > 0 || repairedAniList > 0) {
            enqueueSnackbar(
              `Repaired ${repairedKitsu} Kitsu and ${repairedAniList} AniList media ID${repairedKitsu + repairedAniList === 1 ? "" : "s"}`,
              { variant: "info" },
            );
          }
          if (repair.unresolved.length > 0) {
            enqueueSnackbar(
              `${repair.unresolved.length} item${repair.unresolved.length === 1 ? "" : "s"} could not be fully mapped`,
              { variant: "warning" },
            );
          }
          if (repair.unavailableAniListMappings.length > 0) {
            enqueueSnackbar(
              `${repair.unavailableAniListMappings.length} item${repair.unavailableAniListMappings.length === 1 ? "" : "s"} do not have an AniList mapping`,
              { variant: "info" },
            );
          }
        } catch (error) {
          enqueueSnackbar(
            error instanceof Error
              ? error.message
              : "Unable to repair Kitsu media mappings",
            { variant: "warning" },
          );
        }
      }

      const refreshed = await getSyncStatusAction();
      setData(refreshed);

      const completedLog = refreshed.logs.find(
        (l) => l.id === result.data.logId,
      );
      const providerLabel = PROVIDER_LABELS[provider];
      if (completedLog?.status === "COMPLETED") {
        enqueueSnackbar(
          `${providerLabel} ${direction.toLowerCase()} completed: synced ${completedLog.animeSynced} anime and ${completedLog.mangaSynced} manga (${completedLog.animeChanged} anime / ${completedLog.mangaChanged} manga changed)`,
          { variant: "success" },
        );
      } else {
        enqueueSnackbar(
          `${providerLabel} ${direction.toLowerCase()} finished`,
          {
            variant: "success",
          },
        );
      }
    } finally {
      setRunning(null);
    }
  }

  const isRunning = (provider: string, direction: string) =>
    running === `${provider}-${direction}`;

  const lastLog = (provider: string, direction: string) =>
    data?.logs.find(
      (l) => l.provider === provider && l.direction === direction,
    );

  async function handleValidate() {
    setValidating(true);
    try {
      const result = await normalizeInvalidRatingsAction();
      if (result.ok) {
        const totalFixed = result.data.animeFixed + result.data.mangaFixed;
        if (totalFixed > 0) {
          enqueueSnackbar(
            `Normalized ${totalFixed} invalid rating${totalFixed > 1 ? "s" : ""} (clamped to 2-20 range)`,
            { variant: "info" },
          );
        }
      } else {
        enqueueSnackbar(result.error, { variant: "error" });
      }

      // Then check for any remaining invalid entries
      const invalidResult = await findInvalidEntriesAction();
      const hasInvalid =
        invalidResult.invalidAnime.length > 0 ||
        invalidResult.invalidManga.length > 0;

      const invalidAnimeProgress = invalidResult.invalidAnime.filter((entry) =>
        entry.issues.includes("progress exceeds episode count"),
      ).length;
      const invalidMangaProgress = invalidResult.invalidManga.filter((entry) =>
        entry.issues.includes("progress exceeds chapter count"),
      ).length;

      if (invalidAnimeProgress > 0 || invalidMangaProgress > 0) {
        enqueueSnackbar(
          `Found ${invalidAnimeProgress} anime and ${invalidMangaProgress} manga entries with progress beyond episode/chapter limits`,
          { variant: "warning" },
        );
      }

      setHasInvalidEntries(hasInvalid);

      if (hasInvalid) {
        setInvalidData(invalidResult);
        setSelectedAnimeIds(new Set());
        setSelectedMangaIds(new Set());
        setInvalidModalOpen(true);
      } else {
        enqueueSnackbar("No invalid entries found", { variant: "success" });
      }
    } finally {
      setValidating(false);
    }
  }

  async function handleDeleteInvalid() {
    if (!invalidData) return;
    const animeIds = Array.from(selectedAnimeIds);
    const mangaIds = Array.from(selectedMangaIds);
    const total = animeIds.length + mangaIds.length;
    if (total === 0) {
      enqueueSnackbar("Select entries to delete", { variant: "warning" });
      return;
    }
    setLoadingInvalid(true);
    try {
      const result = await deleteInvalidEntriesAction(animeIds, mangaIds);
      if (result.ok) {
        enqueueSnackbar(`Deleted ${total} invalid entries`, {
          variant: "success",
        });
        setInvalidModalOpen(false);
        await fetchStatus();
      } else {
        enqueueSnackbar(result.error, { variant: "error" });
      }
    } finally {
      setLoadingInvalid(false);
    }
  }

  return (
    <Box>
      <Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", mb: 4 }}>
        <Typography color="text.secondary" sx={{ flex: 1 }}>
          Pull imports the latest data from Kitsu or AniList into your local
          database. Push writes your local changes back to the provider.
        </Typography>
        <Button
          variant="outlined"
          color={hasInvalidEntries ? "warning" : "success"}
          size="small"
          startIcon={hasInvalidEntries ? <WarningIcon /> : <CheckIcon />}
          onClick={handleValidate}
          disabled={validating}
          sx={{ textTransform: "none", whiteSpace: "nowrap" }}
        >
          {validating ? "Validating…" : "Validate"}
        </Button>
      </Box>
      <Stack spacing={3}>
        {(["KITSU", "ANILIST"] as const).map((provider) => (
          <ProviderCard
            key={provider}
            provider={provider}
            auth={data?.auth[provider]}
          >
            {provider === "KITSU" ? (
              <KitsuSyncButton
                onSynced={fetchStatus}
                renderAfterButton={(dir) => {
                  const log = lastLog(provider, dir);
                  if (!log) return null;

                  return (
                    <LastRunSummary
                      log={log}
                      expanded={expandedLog === log.id}
                      onToggle={() =>
                        setExpandedLog(expandedLog === log.id ? null : log.id)
                      }
                    />
                  );
                }}
              />
            ) : (
              <Stack
                direction="row"
                spacing={2}
                sx={{ flexWrap: "wrap", alignItems: "flex-start" }}
              >
                {(["PULL", "PUSH"] as const).map((dir) => {
                  const log = lastLog(provider, dir);
                  const busy = isRunning(provider, dir);
                  const isConnected = data?.auth[provider].loggedIn;
                  const disabled = busy || !isConnected;

                  const button = (
                    <Button
                      variant={dir === "PULL" ? "contained" : "outlined"}
                      startIcon={
                        busy ? (
                          <CircularProgress size={16} color="inherit" />
                        ) : dir === "PULL" ? (
                          <CloudDownloadIcon />
                        ) : (
                          <CloudUploadIcon />
                        )
                      }
                      disabled={disabled}
                      onClick={() => triggerSync(provider, dir)}
                      sx={{ textTransform: "none", mb: 1.5 }}
                      fullWidth
                    >
                      {busy
                        ? "Running…"
                        : `${dir === "PULL" ? "Pull from" : "Push to"} ${PROVIDER_LABELS[provider]}`}
                    </Button>
                  );

                  return (
                    <Box key={dir} sx={{ flex: "1 1 240px", minWidth: 0 }}>
                      <Tooltip
                        title={
                          disabled && !busy
                            ? "Connect your account to enable this action"
                            : ""
                        }
                        disableInteractive
                      >
                        <span>{button}</span>
                      </Tooltip>

                      {log && (
                        <LastRunSummary
                          log={log}
                          expanded={expandedLog === log.id}
                          onToggle={() =>
                            setExpandedLog(
                              expandedLog === log.id ? null : log.id,
                            )
                          }
                        />
                      )}
                    </Box>
                  );
                })}
              </Stack>
            )}
          </ProviderCard>
        ))}
      </Stack>

      {/* Recent sync history */}
      {data && data.logs.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600 }}>
            Recent runs
          </Typography>
          <Divider sx={{ mb: 2 }} />
          <Stack spacing={1}>
            {data.logs.map((log) => (
              <LogRow
                key={log.id}
                log={log}
                expanded={expandedRecent === log.id}
                onToggle={() =>
                  setExpandedRecent(expandedRecent === log.id ? null : log.id)
                }
              />
            ))}
          </Stack>
        </Box>
      )}

      {/* Invalid entries modal */}
      <Dialog
        open={invalidModalOpen}
        onClose={() => setInvalidModalOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Invalid entries</DialogTitle>
        <DialogContent>
          {invalidData &&
          (invalidData.invalidAnime.length > 0 ||
            invalidData.invalidManga.length > 0) ? (
            <Stack spacing={2} sx={{ mt: 1 }}>
              {invalidData.invalidAnime.length > 0 && (
                <Box>
                  <Typography
                    variant="subtitle2"
                    sx={{ fontWeight: 600, mb: 1 }}
                  >
                    Anime ({invalidData.invalidAnime.length})
                  </Typography>
                  <Stack spacing={1}>
                    {invalidData.invalidAnime.map((entry) => (
                      <FormControlLabel
                        key={entry.id}
                        control={
                          <Checkbox
                            checked={selectedAnimeIds.has(entry.id)}
                            onChange={(e) => {
                              const newSet = new Set(selectedAnimeIds);
                              if (e.target.checked) {
                                newSet.add(entry.id);
                              } else {
                                newSet.delete(entry.id);
                              }
                              setSelectedAnimeIds(newSet);
                            }}
                          />
                        }
                        label={
                          <Box>
                            <Typography variant="body2">
                              {entry.title || "(untitled)"}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              ID: {entry.id}
                              {entry.progressLimit
                                ? `, Progress: ${entry.progress ?? 0}, Episodes: ${entry.progressLimit}`
                                : ""}
                            </Typography>
                            <Typography variant="caption" color="error">
                              {entry.issues.join(", ")}
                            </Typography>
                          </Box>
                        }
                      />
                    ))}
                  </Stack>
                </Box>
              )}
              {invalidData.invalidManga.length > 0 && (
                <Box>
                  <Typography
                    variant="subtitle2"
                    sx={{ fontWeight: 600, mb: 1 }}
                  >
                    Manga ({invalidData.invalidManga.length})
                  </Typography>
                  <Stack spacing={1}>
                    {invalidData.invalidManga.map((entry) => (
                      <FormControlLabel
                        key={entry.id}
                        control={
                          <Checkbox
                            checked={selectedMangaIds.has(entry.id)}
                            onChange={(e) => {
                              const newSet = new Set(selectedMangaIds);
                              if (e.target.checked) {
                                newSet.add(entry.id);
                              } else {
                                newSet.delete(entry.id);
                              }
                              setSelectedMangaIds(newSet);
                            }}
                          />
                        }
                        label={
                          <Box>
                            <Typography variant="body2">
                              {entry.title || "(untitled)"}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              ID: {entry.id}
                              {entry.progressLimit
                                ? `, Progress: ${entry.progress ?? 0}, Chapters: ${entry.progressLimit}`
                                : ""}
                            </Typography>
                            <Typography variant="caption" color="error">
                              {entry.issues.join(", ")}
                            </Typography>
                          </Box>
                        }
                      />
                    ))}
                  </Stack>
                </Box>
              )}
            </Stack>
          ) : (
            <Typography color="success.main" sx={{ mt: 1 }}>
              No invalid entries found
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInvalidModalOpen(false)}>Cancel</Button>
          <Button
            onClick={handleDeleteInvalid}
            variant="contained"
            color="error"
            disabled={
              loadingInvalid ||
              !invalidData ||
              (invalidData.invalidAnime.length === 0 &&
                invalidData.invalidManga.length === 0) ||
              (selectedAnimeIds.size === 0 && selectedMangaIds.size === 0)
            }
          >
            {loadingInvalid ? "Deleting..." : "Delete selected"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function ProviderCard({
  provider,
  auth,
  children,
}: {
  provider: "KITSU" | "ANILIST";
  auth?: SyncStatusPayload["auth"]["KITSU"];
  children: ReactNode;
}) {
  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {PROVIDER_LABELS[provider]}
        </Typography>
        {auth?.loggedIn ? (
          <Chip
            label={`@${auth.username}`}
            color="success"
            size="small"
            variant="outlined"
          />
        ) : (
          <Chip
            label="Not connected"
            color="warning"
            size="small"
            variant="outlined"
            component="a"
            href="/link"
            clickable
          />
        )}
      </Box>
      {children}
    </Paper>
  );
}

function statusColor(status: string) {
  if (status === "COMPLETED") return "success";
  if (status === "FAILED") return "error";
  if (status === "CANCELLED") return "default";
  return "warning";
}

function LogDetails({
  errors,
  deletions,
  expanded,
  onToggle,
  compact,
}: {
  errors: string[];
  deletions: string[];
  expanded: boolean;
  onToggle: () => void;
  compact?: boolean;
}) {
  const hasErrors = errors.length > 0;
  const hasDeletions = deletions.length > 0;
  if (!hasErrors && !hasDeletions) return null;

  return (
    <>
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        {hasErrors && (
          <Button
            size="small"
            color="error"
            startIcon={<ErrorOutlineIcon />}
            onClick={onToggle}
            sx={{
              textTransform: "none",
              p: 0,
              ...(compact ? { ml: 1.5 } : { alignSelf: "flex-start" }),
            }}
          >
            {errors.length} error{errors.length > 1 ? "s" : ""}
          </Button>
        )}
        {hasDeletions && (
          <Button
            size="small"
            color="warning"
            startIcon={<DeleteOutlineIcon />}
            onClick={onToggle}
            sx={{
              textTransform: "none",
              p: 0,
              ...(compact ? {} : { alignSelf: "flex-start" }),
            }}
          >
            {deletions.length} deleted
          </Button>
        )}
      </Box>
      <Collapse in={expanded}>
        {hasErrors && (
          <Box
            component="ul"
            sx={{ m: 0, pl: 2, mt: 0.5, color: "error.main", fontSize: 11 }}
          >
            {errors.map((e, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static list
              <li key={i}>{e}</li>
            ))}
          </Box>
        )}
        {hasDeletions && (
          <Box
            component="ul"
            sx={{ m: 0, pl: 2, mt: 0.5, color: "warning.main", fontSize: 11 }}
          >
            {deletions.map((d, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static list
              <li key={i}>Deleted {d}</li>
            ))}
          </Box>
        )}
      </Collapse>
    </>
  );
}

function LastRunSummary({
  log,
  expanded,
  onToggle,
}: {
  log: SyncLog;
  expanded: boolean;
  onToggle: () => void;
}) {
  const errors = (log.errors as string[]) ?? [];
  const deletions = (log.deletions as string[]) ?? [];

  return (
    <Box sx={{ fontSize: 12 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Chip
          label={log.status}
          color={statusColor(log.status) as "success" | "error" | "warning"}
          size="small"
        />
        <Typography variant="caption" color="text.secondary">
          {new Date(log.startedAt).toLocaleString()}
        </Typography>
        {log.status === "RUNNING" && <CircularProgress size={12} />}
      </Box>
      {log.status !== "RUNNING" && (
        <Typography variant="caption" color="text.secondary">
          {log.animeSynced} anime
          {log.animeChanged ? ` (${log.animeChanged} changed)` : ""} ·{" "}
          {log.mangaSynced} manga
          {log.mangaChanged ? ` (${log.mangaChanged} changed)` : ""}
        </Typography>
      )}
      <LogDetails
        errors={errors}
        deletions={deletions}
        expanded={expanded}
        onToggle={onToggle}
        compact
      />
    </Box>
  );
}

function LogRow({
  log,
  expanded,
  onToggle,
}: {
  log: SyncLog;
  expanded: boolean;
  onToggle: () => void;
}) {
  const errors = (log.errors as string[]) ?? [];
  const deletions = (log.deletions as string[]) ?? [];

  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 0.5 }}
    >
      <Box
        sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}
      >
        <Chip
          label={PROVIDER_LABELS[log.provider as "KITSU" | "ANILIST"]}
          size="small"
        />
        <Chip label={log.direction} size="small" variant="outlined" />
        <Chip
          label={log.status}
          size="small"
          color={statusColor(log.status) as "success" | "error" | "warning"}
        />
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ ml: "auto" }}
        >
          {new Date(log.startedAt).toLocaleString()}
          {log.finishedAt && (
            <>
              {" "}
              (
              {Math.round(
                (new Date(log.finishedAt).getTime() -
                  new Date(log.startedAt).getTime()) /
                  1000,
              )}
              s)
            </>
          )}
        </Typography>
      </Box>
      <Typography variant="caption" color="text.secondary">
        {log.animeSynced} anime
        {log.animeChanged ? ` (${log.animeChanged} changed)` : ""} ·{" "}
        {log.mangaSynced} manga
        {log.mangaChanged ? ` (${log.mangaChanged} changed)` : ""}
      </Typography>
      <LogDetails
        errors={errors}
        deletions={deletions}
        expanded={expanded}
        onToggle={onToggle}
      />
    </Paper>
  );
}
