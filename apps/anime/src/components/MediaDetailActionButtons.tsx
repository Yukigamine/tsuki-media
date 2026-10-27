"use client";

import EditIcon from "@mui/icons-material/Edit";
import { Button, Stack } from "@mui/material";
import type { ReactNode } from "react";

type QuickAction = {
  key: string;
  label: string;
  onClick: () => void;
};

type LabelAction = {
  label: string;
  icon: ReactNode;
  onClick: () => void;
};

type Props = {
  pending: boolean;
  quickActions: QuickAction[];
  topAction?: LabelAction;
  bottomAction?: LabelAction;
  onEdit?: () => void;
};

export default function MediaDetailActionButtons({
  pending,
  quickActions,
  topAction,
  bottomAction,
  onEdit,
}: Props) {
  return (
    <Stack spacing={1} sx={{ width: "100%" }}>
      {topAction && (
        <Button
          variant="outlined"
          fullWidth
          disabled={pending}
          startIcon={topAction.icon}
          onClick={topAction.onClick}
        >
          {topAction.label}
        </Button>
      )}

      {quickActions.map((action) => (
        <Button
          key={action.key}
          variant="outlined"
          fullWidth
          disabled={pending}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ))}

      {bottomAction && (
        <Button
          variant="outlined"
          fullWidth
          disabled={pending}
          startIcon={bottomAction.icon}
          onClick={bottomAction.onClick}
        >
          {bottomAction.label}
        </Button>
      )}

      {onEdit ? (
        <Button
          variant="contained"
          color="primary"
          startIcon={<EditIcon />}
          fullWidth
          disabled={pending}
          onClick={onEdit}
        >
          Edit
        </Button>
      ) : null}
    </Stack>
  );
}
