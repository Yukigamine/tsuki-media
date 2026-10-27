import {
  Box,
  Container,
  Paper,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@mui/material";

export default function ProfileSkeleton() {
  return (
    <Box>
      <Box
        sx={{
          position: "relative",
          width: "100%",
          height: { xs: 120, md: 200 },
          bgcolor: "action.hover",
          overflow: "hidden",
        }}
      >
        <Skeleton variant="rectangular" width="100%" height="100%" />
      </Box>

      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Skeleton variant="text" width={300} height={40} sx={{ mb: 3 }} />

        <Box
          sx={{
            display: "flex",
            flexDirection: { xs: "column", md: "row" },
            gap: 4,
            alignItems: "flex-start",
          }}
        >
          <Box sx={{ flexShrink: 0, width: { xs: "100%", md: 280 } }}>
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Box
                sx={{
                  display: "flex",
                  gap: 2,
                  alignItems: "flex-start",
                  mb: 2,
                }}
              >
                <Skeleton
                  variant="rectangular"
                  width={80}
                  height={80}
                  sx={{ borderRadius: 2 }}
                />
                <Box sx={{ flex: 1 }}>
                  <Skeleton
                    variant="text"
                    width="80%"
                    height={28}
                    sx={{ mb: 1 }}
                  />
                  <Skeleton variant="text" width="40%" height={16} />
                </Box>
              </Box>
              <Skeleton variant="text" width="100%" height={60} />
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Table size="small">
                <TableBody>
                  {[...Array(4)].map((_, i) => (
                    <TableRow key={i}>
                      <TableCell
                        sx={{
                          fontWeight: 600,
                          width: 140,
                          borderBottom: "none",
                          py: 0.75,
                          pl: 0,
                        }}
                      >
                        <Skeleton variant="text" width={80} />
                      </TableCell>
                      <TableCell sx={{ borderBottom: "none", py: 0.75 }}>
                        <Skeleton variant="text" width="60%" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Skeleton variant="text" width={100} height={20} sx={{ mb: 1 }} />
              <Table size="small">
                <TableBody>
                  {[...Array(3)].map((_, i) => (
                    <TableRow key={i}>
                      <TableCell
                        sx={{
                          fontWeight: 600,
                          width: 140,
                          borderBottom: "none",
                          py: 0.75,
                          pl: 0,
                        }}
                      >
                        <Skeleton variant="text" width={80} />
                      </TableCell>
                      <TableCell sx={{ borderBottom: "none", py: 0.75 }}>
                        <Skeleton variant="text" width="60%" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>
          </Box>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Skeleton variant="text" width={150} height={32} sx={{ mb: 2 }} />
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gap: 2,
              }}
            >
              {[...Array(8)].map((_, i) => (
                <Skeleton
                  key={i}
                  variant="rectangular"
                  width="100%"
                  height={200}
                  sx={{ borderRadius: 1 }}
                />
              ))}
            </Box>
          </Box>
        </Box>
      </Container>
    </Box>
  );
}
