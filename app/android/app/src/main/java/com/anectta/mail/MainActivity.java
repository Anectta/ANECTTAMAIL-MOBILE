package com.anectta.mail;

import android.os.Bundle;

import com.anectta.mail.plugin.AnecttaMailPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Motor de e-mail nativo (IMAP/SMTP direto do aparelho)
        registerPlugin(AnecttaMailPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
