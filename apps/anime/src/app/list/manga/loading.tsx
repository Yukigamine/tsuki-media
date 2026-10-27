import { Container, Grid, Typography } from "@mui/material";
import CardSkeleton from "@/components/CardSkeleton";

export default function Loading() {
  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 4 }}>
        Manga List
      </Typography>
      <Grid container spacing={2}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Grid key={i} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
            <CardSkeleton />
          </Grid>
        ))}
      </Grid>
    </Container>
  );
}
