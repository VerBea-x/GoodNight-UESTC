package io.github.beicheno2.goodnight;

import android.content.Context;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;

final class Config {
    static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
    static SecurePrefs prefs(Context c) { return new SecurePrefs(c); }
    static LocalTime time(Context c, String key, String fallback) {
        try { return LocalTime.parse(prefs(c).getString(key, fallback)); } catch (Exception e) { return LocalTime.parse(fallback); }
    }
    static boolean within(Context c) {
        LocalTime now = ZonedDateTime.now(ZONE).toLocalTime();
        return !now.isBefore(time(c,"start","21:00")) && now.isBefore(time(c,"end","23:00"));
    }
    static boolean valid(Context c) {
        SecurePrefs p=prefs(c);
        double lat=Double.longBitsToDouble(p.getLong("lat",Double.doubleToRawLongBits(Double.NaN)));
        double lng=Double.longBitsToDouble(p.getLong("lng",Double.doubleToRawLongBits(Double.NaN)));
        return Double.isFinite(lat)&&Double.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180&&time(c,"start","21:00").isBefore(time(c,"end","23:00"));
    }
    static double latitude(Context c) { return Double.longBitsToDouble(prefs(c).getLong("lat",Double.doubleToRawLongBits(Double.NaN))); }
    static double longitude(Context c) { return Double.longBitsToDouble(prefs(c).getLong("lng",Double.doubleToRawLongBits(Double.NaN))); }
    static void location(Context c,double lat,double lng) { prefs(c).edit().putLong("lat",Double.doubleToRawLongBits(lat)).putLong("lng",Double.doubleToRawLongBits(lng)).apply(); }
}
