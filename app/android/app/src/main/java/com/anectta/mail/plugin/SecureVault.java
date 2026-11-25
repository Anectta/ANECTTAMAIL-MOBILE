package com.anectta.mail.plugin;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Cofre de senhas do aparelho: cada valor é cifrado com AES-256-GCM usando uma chave que
 * fica no Android Keystore (não sai do aparelho e não pode ser exportada).
 * Só o texto cifrado é gravado nas preferências do app.
 */
public final class SecureVault {

    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "anectta_mail_vault_v1";
    private static final String PREFS = "anectta_mail_vault";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";

    private final SharedPreferences prefs;

    public SecureVault(Context context) {
        this.prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE);
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        kg.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return kg.generateKey();
    }

    public synchronized void put(String name, String value) throws Exception {
        Cipher c = Cipher.getInstance(TRANSFORMATION);
        c.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = c.getIV();
        byte[] sealed = c.doFinal(value.getBytes(StandardCharsets.UTF_8));
        String packed = Base64.encodeToString(iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(sealed, Base64.NO_WRAP);
        prefs.edit().putString(name, packed).apply();
    }

    /** Valor guardado, ou null se não existir ou não puder ser aberto (ex.: chave recriada). */
    public synchronized String get(String name) {
        String packed = prefs.getString(name, null);
        if (packed == null) return null;
        try {
            int sep = packed.indexOf(':');
            byte[] iv = Base64.decode(packed.substring(0, sep), Base64.NO_WRAP);
            byte[] sealed = Base64.decode(packed.substring(sep + 1), Base64.NO_WRAP);
            Cipher c = Cipher.getInstance(TRANSFORMATION);
            c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            return new String(c.doFinal(sealed), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    public synchronized void remove(String name) {
        prefs.edit().remove(name).apply();
    }

    public synchronized boolean has(String name) {
        return prefs.contains(name);
    }
}
