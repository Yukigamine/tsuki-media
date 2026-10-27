"use client";

import EditIcon from "@mui/icons-material/Edit";
import { IconButton, Tooltip } from "@mui/material";
import AppLink from "@/components/Link";

type Props = {
  title: string;
  editHref: string;
  card?: boolean;
};

export function CollectionItemActions({ title, editHref, card }: Props) {
  return (
    <Tooltip title={`Edit ${title}`}>
      <IconButton
        className={card ? "collection-edit-action" : undefined}
        size="small"
        component={AppLink}
        href={editHref}
        aria-label={`Edit ${title}`}
        sx={
          card
            ? {
                bgcolor: "background.paper",
                opacity: 0,
                pointerEvents: "none",
                transition: "opacity 0.15s ease",
              }
            : undefined
        }
      >
        <EditIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
