// JDBC fallback for query.mjs when psql is not installed. Do not run it by
// hand: query.mjs checks the SQL, picks the database, and starts it as
//
//   java -cp <postgresql.jar> QueryJdbc.java <sql-file>
//
// The login comes from the environment variables FREYA_DB_HOST, FREYA_DB_PORT,
// FREYA_DB_NAME, FREYA_DB_USER and FREYA_DB_PASSWORD, never from arguments.
// The session is read-only with a 60 s statement timeout, as with psql.
// Output is the last result set as CSV in psql --csv form: NULL is an empty
// unquoted field, an empty string is "". Errors go to stderr, exit 1.

import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Properties;

public class QueryJdbc {
    public static void main(String[] args) {
        PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);
        PrintStream err = new PrintStream(new FileOutputStream(FileDescriptor.err), true, StandardCharsets.UTF_8);
        try {
            if (args.length != 1) throw new IllegalArgumentException("Usage: QueryJdbc <sql-file>");
            String sql = Files.readString(Path.of(args[0]), StandardCharsets.UTF_8);
            run(sql, out);
        } catch (SQLException e) {
            StringBuilder message = new StringBuilder(String.valueOf(e.getMessage()));
            if (e.getSQLState() != null) message.append(" (SQLSTATE ").append(e.getSQLState()).append(')');
            err.println(message);
            System.exit(1);
        } catch (Exception e) {
            err.println(e.getClass().getSimpleName() + ": " + e.getMessage());
            System.exit(1);
        }
    }

    private static String env(String name) {
        String value = System.getenv(name);
        if (value == null || value.isEmpty()) throw new IllegalStateException(name + " is not set");
        return value;
    }

    private static void run(String sql, PrintStream out) throws SQLException {
        String url = "jdbc:postgresql://" + env("FREYA_DB_HOST") + ":" + env("FREYA_DB_PORT") + "/" + env("FREYA_DB_NAME");
        Properties props = new Properties();
        props.setProperty("user", env("FREYA_DB_USER"));
        props.setProperty("password", env("FREYA_DB_PASSWORD"));
        props.setProperty("connectTimeout", "5");
        props.setProperty("loginTimeout", "5");
        props.setProperty("ApplicationName", "freya-dev-db-query");
        props.setProperty("options", "-c default_transaction_read_only=on -c statement_timeout=60s");
        try (Connection connection = DriverManager.getConnection(url, props)) {
            connection.setReadOnly(true);
            try (Statement statement = connection.createStatement()) {
                boolean isResult = statement.execute(sql);
                ResultSet last = null;
                while (true) {
                    if (isResult) {
                        if (last != null) last.close();
                        last = statement.getResultSet();
                    } else if (statement.getUpdateCount() == -1) {
                        break;
                    }
                    isResult = statement.getMoreResults(Statement.KEEP_CURRENT_RESULT);
                }
                if (last == null) throw new IllegalStateException("The statement returned no rows.");
                try (ResultSet rs = last) {
                    print(rs, out);
                }
            }
        }
    }

    private static void print(ResultSet rs, PrintStream out) throws SQLException {
        ResultSetMetaData meta = rs.getMetaData();
        int columns = meta.getColumnCount();
        StringBuilder line = new StringBuilder();
        for (int i = 1; i <= columns; i++) {
            if (i > 1) line.append(',');
            line.append(csv(meta.getColumnLabel(i)));
        }
        out.println(line);
        while (rs.next()) {
            line.setLength(0);
            for (int i = 1; i <= columns; i++) {
                if (i > 1) line.append(',');
                String value = rs.getString(i);
                if (value != null) line.append(csv(value));
            }
            out.println(line);
        }
    }

    // psql --csv quotes an empty string so that it differs from NULL.
    private static String csv(String value) {
        boolean quote = value.isEmpty()
                || value.indexOf(',') >= 0
                || value.indexOf('"') >= 0
                || value.indexOf('\n') >= 0
                || value.indexOf('\r') >= 0;
        return quote ? '"' + value.replace("\"", "\"\"") + '"' : value;
    }
}
