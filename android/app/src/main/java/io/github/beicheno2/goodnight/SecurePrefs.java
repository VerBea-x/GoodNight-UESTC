package io.github.beicheno2.goodnight;

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

/** Encrypts app settings with an Android Keystore key and migrates legacy values on read. */
final class SecurePrefs {
    private static final String ALIAS="goodnight.settings.v1";
    private final SharedPreferences secure, legacy;
    private final SecretKey key;
    SecurePrefs(Context context){
        secure=context.getSharedPreferences("goodnight_secure",Context.MODE_PRIVATE);
        legacy=context.getSharedPreferences("goodnight",Context.MODE_PRIVATE);
        try{
            KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
            if(!store.containsAlias(ALIAS)){
                KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
                generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
                generator.generateKey();
            }
            key=((KeyStore.SecretKeyEntry)store.getEntry(ALIAS,null)).getSecretKey();
        }catch(Exception e){throw new IllegalStateException("无法访问本机加密密钥，请检查设备安全设置",e);}
    }
    private String encrypt(String value){
        try{Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key);
            byte[] iv=cipher.getIV(),out=cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            byte[] bytes=new byte[iv.length+out.length];System.arraycopy(iv,0,bytes,0,iv.length);System.arraycopy(out,0,bytes,iv.length,out.length);
            return Base64.encodeToString(bytes,Base64.NO_WRAP);
        }catch(Exception e){throw new IllegalStateException("加密设置失败",e);}
    }
    private String decrypt(String value){
        try{byte[] bytes=Base64.decode(value,Base64.NO_WRAP);if(bytes.length<29)throw new IllegalArgumentException();
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,bytes,0,12));
            return new String(cipher.doFinal(bytes,12,bytes.length-12),StandardCharsets.UTF_8);
        }catch(Exception e){throw new IllegalStateException("无法解密本机设置；请勿清除系统密钥后恢复旧数据",e);}
    }
    private synchronized String value(String name,String fallback){
        String encrypted=secure.getString(name,null);
        if(encrypted!=null)return decrypt(encrypted);
        if(!legacy.contains(name))return fallback;
        Object old=legacy.getAll().get(name);
        if(old==null)return fallback;
        String plain=String.valueOf(old);
        if(!secure.edit().putString(name,encrypt(plain)).commit())throw new IllegalStateException("迁移本机设置失败");
        if(!legacy.edit().remove(name).commit())throw new IllegalStateException("清除旧设置失败");
        return plain;
    }
    String getString(String name,String fallback){return value(name,fallback);}
    long getLong(String name,long fallback){String value=value(name,null);return value==null?fallback:Long.parseLong(value);}
    boolean getBoolean(String name,boolean fallback){String value=value(name,null);return value==null?fallback:Boolean.parseBoolean(value);}
    Editor edit(){return new Editor();}
    final class Editor {
        private final SharedPreferences.Editor changes=secure.edit(),removals=legacy.edit();
        Editor putString(String name,String value){changes.putString(name,encrypt(value));removals.remove(name);return this;}
        Editor putLong(String name,long value){return putString(name,Long.toString(value));}
        Editor putBoolean(String name,boolean value){return putString(name,Boolean.toString(value));}
        Editor remove(String name){changes.remove(name);removals.remove(name);return this;}
        boolean commit(){boolean ok=changes.commit();if(ok)removals.commit();return ok;}
        void apply(){commit();}
    }
}
