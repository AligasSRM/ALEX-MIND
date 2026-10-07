package com.alexmind.app;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final String API = "https://alex-mind.srourr-ali73.workers.dev";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private TextView status;
    private TextView details;
    private ProgressBar progress;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildUi();
        checkBackend();
    }

    private TextView text(String value, float size) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextSize(size);
        t.setTextColor(Color.WHITE);
        t.setPadding(0, 8, 0, 8);
        return t;
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(28, 34, 28, 28);
        root.setBackgroundColor(Color.rgb(11, 13, 16));

        TextView logo = text("ALEX-MIND", 30);
        logo.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        logo.setTextColor(Color.rgb(77, 163, 255));
        root.addView(logo);

        TextView subtitle = text("Secure AI Control", 15);
        subtitle.setTextColor(Color.LTGRAY);
        root.addView(subtitle);

        status = text("● CHECKING", 22);
        status.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        status.setPadding(0, 36, 0, 16);
        root.addView(status);

        details = text("Connecting to ALEX-MIND backend…", 15);
        details.setTextColor(Color.LTGRAY);
        root.addView(details);

        progress = new ProgressBar(this);
        root.addView(progress);

        Button check = new Button(this);
        check.setText("CHECK NOW");
        check.setOnClickListener(v -> checkBackend());
        LinearLayout.LayoutParams buttonParams =
            new LinearLayout.LayoutParams(-1, -2);
        buttonParams.topMargin = 28;
        root.addView(check, buttonParams);

        TextView endpoint = text("Backend\n" + API, 13);
        endpoint.setTextColor(Color.GRAY);
        endpoint.setPadding(0, 34, 0, 8);
        root.addView(endpoint);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        setContentView(scroll);
    }

    private void checkBackend() {
        runOnUiThread(() -> {
            progress.setVisibility(View.VISIBLE);
            status.setText("● CHECKING");
            status.setTextColor(Color.rgb(255, 193, 7));
            details.setText("Connecting to ALEX-MIND backend…");
        });

        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL(API + "/health");
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);
                connection.setUseCaches(false);

                int code = connection.getResponseCode();
                boolean ok = code == 200;

                runOnUiThread(() -> {
                    progress.setVisibility(View.GONE);
                    if (ok) {
                        status.setText("● ONLINE");
                        status.setTextColor(Color.rgb(60, 220, 120));
                        details.setText("Backend reachable\nHTTPS /health returned 200 OK");
                    } else {
                        status.setText("● OFFLINE");
                        status.setTextColor(Color.rgb(255, 80, 80));
                        details.setText("Backend returned HTTP " + code);
                    }
                });
            } catch (IOException e) {
                runOnUiThread(() -> {
                    progress.setVisibility(View.GONE);
                    status.setText("● OFFLINE");
                    status.setTextColor(Color.rgb(255, 80, 80));
                    details.setText("Connection failed\n" + e.getClass().getSimpleName());
                });
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }
}
