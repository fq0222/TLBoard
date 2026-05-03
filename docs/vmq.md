
一、创建订单
请求地址：http://localhost:8080/createOrder
请求方式：POST/GET
通讯密钥（示例）：a7cc8678193ee9c70ae3d75fd04ae6a9

校验签名（示例）：md5(1547129707139vone66620.1a7cc8678193ee9c70ae3d75fd04ae6a9) = 2b8b5d58c51203162f14939bdbc46a54

参数示例（示例）：payId=1547129707139&type=2&price=0.1&sign=2b8b5d58c51203162f14939bdbc46a54&param=vone666&isHtml=0

参数说明:

参数	参数类型	参数说明
payId	字符串	【必传】商户订单号，可以是时间戳，不可重复
type	整数	【必传】微信支付传入1 支付宝支付传入2
price	小数	【必传】订单金额
sign	字符串	【必传】签名，计算方式为 md5(payId+param+type+price+通讯密钥)
param	字符串	【可选】传输参数，将会原样返回到异步和同步通知接口
isHtml	整数	【可选】传入1则自动跳转到支付页面，否则返回创建结果的json数据


返回数据（示例）：{"code":1,"msg":"成功","data":{"payId":"1547129707139","orderId":"201901102220147500","payType":2,"price":0.1,"reallyPrice":0.1,"payUrl":"HTTPS://QR.ALIPAY.COM/FKX03500Z2ZYWA0ELYUB5D","isAuto":1,"state":0,"timeOut":5,"date":1547130014777}}

返回数据说明:
返回参数	参数类型	参数说明
code	整数	返回代码（1：成功，-1：调用失败）
msg	字符串	api调用结果说明
data	数组	api调用结果（如果code为-1，则data为null）
返回参数	参数类型	参数说明
payId	字符串	商户订单号
orderId	字符串	云端订单号，可用于查询订单是否支付成功
payType	整数	微信支付为1 支付宝支付为2
price	小数	订单金额
reallyPrice	小数	实际需付金额
payUrl	字符串	支付二维码内容
isAuto	整数	1需要手动输入金额 0扫码后自动输入金额
state	整数	订单状态：-1|订单过期 0|等待支付 1|完成 2|支付完成但通知失败
timeOut	整数	订单有效时间（分钟）
date	长整数	订单创建时间时间戳（13位）


二、查询订单信息
请求地址：http://localhost:8080/getOrder
请求方式：POST/GET
参数示例（示例）：orderId=201901102225513177

参数说明:

参数	参数类型	参数说明
orderId	字符串	【必传】云端订单号，创建订单返回的

返回数据（示例）：{"code":1,"msg":"成功","data":{"payId":"1547129707139","orderId":"201901102220147500","payType":2,"price":0.1,"reallyPrice":0.1,"payUrl":"HTTPS://QR.ALIPAY.COM/FKX03500Z2ZYWA0ELYUB5D","isAuto":1,"state":0,"timeOut":5,"date":1547130014777}}

返回数据说明:
返回参数	参数类型	参数说明
code	整数	返回代码（1：成功，-1：调用失败）
msg	字符串	api调用结果说明
data	数组	api调用结果（如果code为-1，则data为null）
返回参数	参数类型	参数说明
payId	字符串	商户订单号
orderId	字符串	云端订单号，可用于查询订单是否支付成功
payType	整数	微信支付为1 支付宝支付为2
price	小数	订单金额
reallyPrice	小数	实际需付金额
payUrl	字符串	支付二维码内容
isAuto	整数	1需要手动输入金额 0扫码后自动输入金额
state	整数	订单状态：-1|订单过期 0|等待支付 1|完成 2|支付完成但通知失败
timeOut	整数	订单有效时间（分钟）
date	长整数	订单创建时间时间戳（13位）

三、查询订单状态
请求地址：http://localhost:8080/checkOrder
请求方式：POST/GET
参数示例（示例）：orderId=201901102225513177

参数说明:

参数	参数类型	参数说明
orderId	字符串	【必传】云端订单号，创建订单返回的
返回数据（示例）：{"code":1,"msg":"成功","data":"https://bbs.125.la/?payId=1547130880571&param=vone666&type=2&price=0.1&reallyPrice=0.1&sign=c79f041bd5bc47d73bc19dc8406c9843"}

返回数据说明:
返回参数	参数类型	参数说明
code	整数	返回代码（1：订单已被支付，-1：支付失败或还未支付，具体查看msg字段）
msg	字符串	调用结果说明
data	字符串	如果code为-1，则data为null，否则为该订单支付完成后的跳转地址（带回调参数）

四、关闭订单
请求地址：http://localhost:8080/closeOrder
请求方式：POST/GET
参数示例（示例）：orderId=201901102225513177&sign=7db2d26323dd8ccbb5d130dd61d210a0

参数说明:

参数	参数类型	参数说明
orderId	字符串	【必传】云端订单号，创建订单返回的
sign	字符串	【必传】md5(云端订单号+通讯密钥)
返回数据（示例）：{"code":1,"msg":"成功","data":null}

返回数据说明:
返回参数	参数类型	参数说明
code	整数	返回代码（1：订单关闭成功，-1：订单关闭失败，具体原因查看msg字段）
msg	字符串	调用结果说明
data	字符串	无用字段，请忽略

五、查新服务端状态
请求地址：http://localhost:8080/getState
请求方式：POST/GET
参数示例（示例）：t=1547613643141&sign=7db2d26323dd8ccbb5d130dd61d210a0

参数说明:

参数	参数类型	参数说明
t	长整数	【必传】现行时间戳
sign	字符串	【必传】md5(现行时间戳+通讯密钥)
返回数据（示例）：{"code":1,"msg":"成功","data":{"lastpay":"1547394640856","lastheart":"1547613873755","state":"1"}}

返回数据说明:
返回参数	参数类型	参数说明
code	整数	返回代码（1：成功，-1：失败，具体原因查看msg字段）
msg	字符串	调用结果说明
data	字符串	api调用结果（如果code为-1，则data为null）
返回参数	参数类型	参数说明
lastpay	长整数	最后一次监控到支付的时间戳（13位）
lastheart	长整数	最后一次监控端向服务器发送心跳的时间戳（13位）
state	整数	监控端状态 1|在线 0|掉线 -1|还未绑定监控端

六、回调参数说明
当系统收到用户收款后，将会向您后台设定的异步通知地址发送GET请求，通知您的服务端订单完成收款 若您使用的是isHtml=1则在支付完成后会携带参数跳转到您的同步通知接口，若使用isHtml=0则只有异步通知
传输参数（示例）：payId=1547130349673&param=vone666&type=2&price=0.1&reallyPrice=0.1&sign=28943820b95019b6a63598a13c46f93f

传输参数说明:
返回参数	参数类型	参数说明
payId	字符串	商户订单号
param	字符串	创建订单的时候传入的参数
type	整数	支付方式 ：微信支付为1 支付宝支付为2
price	小数	订单金额
reallyPrice	小数	实际支付金额
sign	字符串	校验签名，计算方式 = md5(payId + param + type + price + reallyPrice + 通讯密钥)

PHP回调示例代码layui.code
<?php
ini_set("error_reporting","E_ALL & ~E_NOTICE");
$key = "83d551f0b3609781a22536ca2658473d";//通讯密钥
$payId = $_GET['payId'];//商户订单号
$param = $_GET['param'];//创建订单的时候传入的参数
$type = $_GET['type'];//支付方式 ：微信支付为1 支付宝支付为2
$price = $_GET['price'];//订单金额
$reallyPrice = $_GET['reallyPrice'];//实际支付金额
$sign = $_GET['sign'];//校验签名，计算方式 = md5(payId + param + type + price + reallyPrice + 通讯密钥)
//开始校验签名
$_sign =  md5($payId . $param . $type . $price . $reallyPrice . $key);
if ($_sign != $sign) {
    echo "error_sign";//sign校验不通过
    exit();
}
echo "success";
//继续业务流程
//echo "商户订单号：".$payId ."<br>自定义参数：". $param ."<br>支付方式：". $type ."<br>订单金额：". $price ."<br>实际支付金额：". $reallyPrice;
?>
