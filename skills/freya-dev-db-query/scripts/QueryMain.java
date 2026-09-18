import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.Set;

/**
 * One-shot JDBC reader used by query.ps1. Compiled to a user cache; do not commit .class files.
 */
public class QueryMain {
    private static final ZoneId REPORT_ZONE = ZoneId.of("Asia/Shanghai");
    private static final DateTimeFormatter REPORT_FORMAT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSS xxx", Locale.ROOT);
    private static final Set<String> EPOCH_MS_COLUMNS = Set.of(
            "create_time", "update_time", "start_at", "end_at", "execution_deadline");

    public static void main(String[] args) throws Exception {
        long started = System.nanoTime();
        Class.forName("org.postgresql.Driver");
        String sql = Files.readString(Path.of(args[0]), StandardCharsets.UTF_8);
        String url = args[1];
        try (Connection connection = DriverManager.getConnection(
                url,
                System.getenv("FREYA_DEV_DB_USER"),
                System.getenv("FREYA_DEV_DB_PASSWORD"));
             Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery(sql)) {
            ResultSetMetaData meta = result.getMetaData();
            int columnCount = meta.getColumnCount();
            String[] names = new String[columnCount];
            boolean[] epochMs = new boolean[columnCount];
            for (int i = 1; i <= columnCount; i++) {
                names[i - 1] = meta.getColumnLabel(i);
                epochMs[i - 1] = EPOCH_MS_COLUMNS.contains(names[i - 1].toLowerCase(Locale.ROOT));
            }
            System.out.println(String.join("\t", names));
            int rows = 0;
            while (result.next()) {
                String[] values = new String[columnCount];
                for (int i = 1; i <= columnCount; i++) {
                    Object value = result.getObject(i);
                    values[i - 1] = formatValue(value, epochMs[i - 1]);
                }
                System.out.println(String.join("\t", values));
                rows++;
            }
            long elapsedMs = (System.nanoTime() - started) / 1_000_000L;
            System.out.println("ROW_COUNT=" + rows);
            System.out.println("QUERY_MS=" + elapsedMs);
        }
    }

    private static String formatValue(Object value, boolean epochMsColumn) {
        if (value == null) {
            return "NULL";
        }
        if (epochMsColumn && value instanceof Number) {
            long millis = ((Number) value).longValue();
            if (millis >= 1_000_000_000_000L && millis < 100_000_000_000_000L) {
                String local = Instant.ofEpochMilli(millis)
                        .atZone(REPORT_ZONE)
                        .format(REPORT_FORMAT);
                return millis + " (" + local + ")";
            }
        }
        return String.valueOf(value);
    }
}
