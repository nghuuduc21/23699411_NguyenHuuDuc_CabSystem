1. Hiểu được Business Context (ngữ cảnh nghiệp vụ)
2. Vấn đề nghiệp vụ là gì (Business Promblem) 
KH muốn giải quyết vấn đề gì
Ai là người sử dụng hệ thống  
Tại sao cách truyền thống không thể giải quyết được vấn đề đó
Giá trị của hệ thống tạo ra

3. Xác định các stack holders

| stackholder       | Vai trò là gì      
|-------------|-------------|
| Ban giám đốc (Management)  | Định hướng mục tiêu kinh doanh, phê duyệt ngân sách, theo dõi doanh thu, KPI và hiệu quả hệ thống  |
| Customer – Khách hàng  | Đặt xe, theo dõi chuyến, thanh toán, xem lịch sử và đánh giá tài xế  | 
| Driver – Tài xế  | Nhận/từ chối chuyến, cập nhật trạng thái, cung cấp vị trí và hoàn thành chuyến  | 
| Operator – Nhân viên vận hành  | Điều phối, giám sát chuyến, quản lý tài xế và xử lý các trường hợp bất thường  | 
| Customer Service – CSKH  | Tiếp nhận và xử lý khiếu nại, hỗ trợ khách hàng khi có sự cố  | 
| Kế toán / Finance  | Kiểm tra giao dịch, doanh thu, đối soát và báo cáo tài chính  | 
| IT / System Administrator  | Quản lý hệ thống, triển khai, giám sát và đảm bảo hệ thống hoạt động ổn định  | 
|Payment Provider  | Xử lý thanh toán điện tử và trả kết quả giao dịch  | 
| Map / GPS Provider  | Cung cấp bản đồ, vị trí và dữ liệu phục vụ tìm tài xế  | 
|Notification Provider  |Gửi SMS, Email, Push Notification cho khách hàng và tài xế| 
| BA / Development Team  |Phân tích yêu cầu, thiết kế và xây dựng hệ thống theo yêu cầu nghiệp vụ  | 
| Cơ quan quản lý / pháp lý  | Đảm bảo hệ thống tuân thủ quy định về dữ liệu cá nhân, thanh toán và hoạt động vận tải  | 

 Vẽ ra ma trận stackholders để xác để mức độ ảnh hưởng của các hệ thống
   
| Stakeholder               | Influence | Interest | Mức độ ưu tiên |
| ------------------------- | --------: | -------: | -------------- |
| Ban giám đốc              |         5 |        5 | **Rất cao**    |
| Operator                  |         5 |        5 | **Rất cao**    |
| Customer                  |         3 |        5 | **Cao**        |
| Driver                    |         4 |        5 | **Rất cao**    |
| CSKH                      |         3 |        4 | **Cao**        |
| Kế toán / Finance         |         4 |        4 | **Cao**        |
| IT / System Admin         |         4 |        4 | **Cao**        |
| Payment Provider          |         3 |        3 | Trung bình     |
| Map / GPS Provider        |         3 |        3 | Trung bình     |
| Notification Provider     |         2 |        3 | Trung bình     |
| BA / Development Team     |         4 |        5 | **Rất cao**    |
| Cơ quan quản lý / pháp lý |         5 |        3 | **Cao**        |

Mục đính của nghiệp là gì ? 
  BG01:	Tự động hóa quy trình đặt và phân công xe  
  BG02:	Nâng cao hiệu quả vận hành  
  BG03:	Giảm thời gian tìm kiếm tài xế  
  BG04:	Nâng cao trải nghiệm khách hàng  
  BG05:	Tăng tỷ lệ chuyến xe được hoàn thành  
  BG06:	Nâng cao hiệu quả quản lý thanh toán  
  BG07:	Tăng khả năng kiểm soát và minh bạch dữ liệu  
  BG08:	Nâng cao khả năng giám sát hoạt động kinh doanh  
  BG09:	Đảm bảo tính ổn định và khả năng mở rộng của hệ thống  
  BG10:	Tăng khả năng mở rộng dịch vụ trong tương lai  
  BG11:	Nâng cao tính bảo mật và kiểm soát truy cập  
  BG12:	Giảm rủi ro vận hành  

  Business Goal quan trọng nhất  
  BG01: Tự động hóa quy trình đặt và phân công xe.  
  BG02: Nâng cao hiệu quả vận hành.  
  BG03: Nâng cao trải nghiệm khách hàng.  
  BG04: Nâng cao hiệu quả quản lý thanh toán và dữ liệu.  
  BG05: Đảm bảo khả năng mở rộng và ổn định của hệ thống.  
  BG06: Nâng cao khả năng quản lý, giám sát và ra quyết định dựa trên dữ liệu.  

  Bước 4: Xác định phạm vi (Scopes)  
  
Bước đầu: xây dựng các tính năng cơ bản
- Không xác định được phạm vi sẽ bị lan man quá lớn (Phải bóp lại)
Chức năng đặc biệt phải deal.

SC01	Quản lý tài khoản  
SC02	Quản lý khách hàng  
SC03	Quản lý tài xế  
SC04	Đặt xe  
SC05	Tìm tài xế  
SC06	Phân công chuyến  
SC07	Quản lý chuyến đi  
SC08	Theo dõi chuyến  
SC09	Tính cước  
SC10	Thanh toán  
SC11	Thông báo  
SC12	Đánh giá  
SC13	Quản trị  
SC14	Báo cáo cơ bản  

Business Requirements – CAB System
| Mã         | Business Requirement                                          | Diễn giải                                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------- | -------------------|
| **BR01**   | **Hệ thống cho phép khách hàng đặt xe**                       | Hệ thống cho phép khách hàng nhập điểm đón, điểm đến, lựa chọn loại xe và gửi yêu cầu đặt xe. Sau khi yêu cầu được tạo, hệ thống phải ghi nhận và xử lý yêu cầu đặt xe.                             |
| **BR02**   | **Hệ thống cho phép tìm và phân công tài xế phù hợp**         | Hệ thống tự động xác định các tài xế phù hợp dựa trên vị trí, trạng thái sẵn sàng và các tiêu chí vận hành. Nếu tài xế được đề xuất từ chối hoặc không phản hồi, hệ thống tiếp tục tìm tài xế khác. |
| **BR03**   | **Hệ thống cho phép khách hàng theo dõi chuyến đi**           | Hệ thống cung cấp cho khách hàng thông tin về trạng thái chuyến đi, tài xế đã nhận chuyến, thời gian dự kiến tài xế đến và các trạng thái trong quá trình thực hiện chuyến.                         |
| **BR04**   | **Hệ thống cho phép khách hàng thanh toán chuyến đi**         | Hệ thống cho phép khách hàng thanh toán chi phí chuyến đi bằng các phương thức được doanh nghiệp hỗ trợ.                                                                                            |
| **BR04.1** | **Thanh toán bằng tiền mặt**                                  | Khách hàng có thể thanh toán trực tiếp cho tài xế sau khi hoàn thành chuyến đi. Hệ thống ghi nhận trạng thái thanh toán của chuyến.                                                                 |
| **BR04.2** | **Thanh toán điện tử**                                        | Khách hàng có thể thanh toán thông qua nhà cung cấp thanh toán bên ngoài. Hệ thống không lưu trực tiếp thông tin nhạy cảm của thẻ hoặc tài khoản thanh toán.                                        |
| **BR05**   | **Hệ thống cho phép quản lý thông tin khách hàng**            | Khách hàng có thể đăng ký, đăng nhập và cập nhật thông tin cá nhân. Hệ thống phải xác thực khách hàng trước khi sử dụng các chức năng yêu cầu tài khoản.                                            |
| **BR06**   | **Hệ thống cho phép tài xế quản lý trạng thái hoạt động**     | Tài xế có thể chuyển trạng thái sang sẵn sàng hoặc không sẵn sàng nhận chuyến khi làm việc. Trạng thái này được sử dụng trong quá trình tìm tài xế.                                                 |
| **BR07**   | **Hệ thống cho phép tài xế tiếp nhận và thực hiện chuyến đi** | Tài xế có thể nhận hoặc từ chối yêu cầu chuyến và cập nhật trạng thái như đã đến điểm đón, đã đón khách, đang di chuyển và hoàn thành chuyến.                                                       |
| **BR08**   | **Hệ thống quản lý thông tin tài xế và phương tiện**          | Hệ thống cho phép quản lý hồ sơ tài xế, thông tin phương tiện và trạng thái hoạt động của tài xế.                                                                                                   |
| **BR09**   | **Hệ thống cho phép quản lý và giám sát chuyến đi**           | Nhân viên vận hành có thể xem các chuyến đang diễn ra, kiểm tra trạng thái tài xế, tra cứu lịch sử và hỗ trợ xử lý các trường hợp chuyến bị lỗi.                                                    |
| **BR10**   | **Hệ thống cung cấp chức năng thông báo**                     | Hệ thống gửi thông báo cho khách hàng và tài xế khi có các sự kiện quan trọng như tạo yêu cầu, tài xế nhận chuyến, tài xế đến điểm đón, hoàn thành chuyến và kết quả thanh toán.                    |
| **BR11**   | **Hệ thống cho phép khách hàng đánh giá tài xế**              | Sau khi chuyến đi hoàn thành, khách hàng có thể đánh giá tài xế và hệ thống lưu lại kết quả đánh giá.                                                                                               |
| **BR12**   | **Hệ thống hỗ trợ tính cước chuyến đi**                       | Hệ thống xác định số tiền khách hàng phải thanh toán dựa trên loại dịch vụ và các thông tin liên quan đến chuyến đi theo quy tắc tính cước của doanh nghiệp.                                        |
| **BR13**   | **Hệ thống hỗ trợ quản lý và phân quyền người dùng vận hành** | Hệ thống cho phép nhân viên vận hành thực hiện các chức năng quản trị phù hợp với quyền được cấp và hạn chế các thao tác nhạy cảm đối với nhân viên không có quyền.                                 |
| **BR14**   | **Hệ thống cung cấp báo cáo hoạt động kinh doanh**            | Hệ thống cung cấp dữ liệu và báo cáo về số lượng chuyến, doanh thu, tỷ lệ hoàn thành, tỷ lệ hủy và hiệu quả hoạt động của tài xế.                                                                   |
| **BR15**   | **Hệ thống bảo vệ dữ liệu và lưu vết hoạt động**              | Hệ thống bảo vệ thông tin cá nhân, thông tin phương tiện, dữ liệu vị trí và dữ liệu giao dịch; đồng thời lưu vết các thao tác quan trọng để phục vụ kiểm tra và xử lý sự cố.                        |
| **BR16**   | **Hệ thống có khả năng mở rộng và tích hợp**                  | Hệ thống được thiết kế để có thể bổ sung loại dịch vụ, phương thức thanh toán, nhà cung cấp thông báo hoặc thay đổi một số thành phần kỹ thuật mà không phải xây dựng lại toàn bộ hệ thống.         |

Bước 6: Business Process  

### Bước 7: Functional Requirements – CAB System
1. Đặt xe và xác định vị trí
| Mã       | Functional Requirement                        | Diễn giải                                                                                                                               |
| -------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **FR01** | **Xác định vị trí của khách hàng**            | Hệ thống xác định vị trí hiện tại của khách hàng dựa trên thông tin vị trí được cung cấp hoặc GPS để làm cơ sở xác định điểm đón.       |
| **FR02** | **Tìm tài xế sẵn có**                         | Hệ thống tìm kiếm các tài xế đang ở trạng thái sẵn sàng nhận chuyến trong khu vực phù hợp với điểm đón của khách hàng.                  |
| **FR03** | **Lọc tài xế theo loại xe**                   | Hệ thống lọc danh sách tài xế dựa trên loại xe mà khách hàng đã lựa chọn.                                                               |
| **FR04** | **Tính khoảng cách từ tài xế đến khách hàng** | Hệ thống xác định khoảng cách giữa vị trí hiện tại của tài xế và điểm đón của khách hàng để hỗ trợ lựa chọn tài xế phù hợp.             |
| **FR05** | **Xếp hạng tài xế phù hợp**                   | Hệ thống sắp xếp các tài xế theo các tiêu chí nghiệp vụ như khoảng cách, trạng thái và các tiêu chí ưu tiên được doanh nghiệp quy định. |
| **FR06** | **Gửi yêu cầu nhận chuyến cho tài xế**        | Hệ thống gửi thông tin yêu cầu chuyến đến tài xế phù hợp và chờ tài xế phản hồi.                                                        |


2. Xử lý phản hồi tài xế
| Mã       | Functional Requirement              | Diễn giải                                                                                                                |
| -------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **FR07** | **Xử lý tài xế chấp nhận chuyến**   | Khi tài xế chấp nhận, hệ thống xác nhận tài xế được phân công cho chuyến và cập nhật trạng thái chuyến.                  |
| **FR08** | **Xử lý tài xế từ chối chuyến**     | Khi tài xế từ chối, hệ thống loại tài xế đó khỏi yêu cầu hiện tại và tiếp tục tìm tài xế phù hợp khác.                   |
| **FR09** | **Xử lý tài xế không phản hồi**     | Nếu tài xế không phản hồi trong thời gian quy định, hệ thống xác định yêu cầu hết thời gian và tiếp tục tìm tài xế khác. |
| **FR10** | **Thông báo không tìm được tài xế** | Khi không còn tài xế phù hợp, hệ thống thông báo cho khách hàng rằng yêu cầu đặt xe chưa tìm được tài xế.                |

3. Quản lý chuyến đi
| Mã       | Functional Requirement                | Diễn giải                                                                                                             |
| -------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **FR11** | **Xác nhận tài xế cho chuyến**        | Hệ thống lưu thông tin tài xế được phân công và thông báo cho khách hàng.                                             |
| **FR12** | **Cập nhật trạng thái chuyến đi**     | Hệ thống cho phép cập nhật các trạng thái: đã nhận chuyến, tài xế đã đến, đã đón khách, đang di chuyển và hoàn thành. |
| **FR13** | **Theo dõi vị trí tài xế**            | Hệ thống tiếp nhận và cập nhật vị trí của tài xế trong quá trình thực hiện chuyến để hỗ trợ theo dõi.                 |
| **FR14** | **Hiển thị thông tin chuyến đi**      | Hệ thống hiển thị cho khách hàng thông tin tài xế, phương tiện, trạng thái chuyến và thời gian dự kiến đến.           |
| **FR15** | **Tính thời gian dự kiến tài xế đến** | Hệ thống xác định thời gian dự kiến tài xế đến điểm đón dựa trên vị trí và dữ liệu bản đồ được cung cấp.              |

4. Tính cước và thanh toán
| Mã       | Functional Requirement        | Diễn giải                                                                                                                                             |
| -------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FR16** | **Tính cước chuyến đi**       | Hệ thống tính số tiền khách hàng phải trả dựa trên loại dịch vụ và các quy tắc tính cước của doanh nghiệp.                                            |
| **FR17** | **Xử lý thanh toán tiền mặt** | Hệ thống ghi nhận trạng thái khách hàng thanh toán bằng tiền mặt cho chuyến đi.                                                                       |
| **FR18** | **Xử lý thanh toán điện tử**  | Hệ thống gửi yêu cầu thanh toán đến nhà cung cấp bên ngoài và nhận kết quả giao dịch.                                                                 |
| **FR19** | **Xử lý thanh toán thất bại** | Hệ thống thông báo kết quả thất bại và cho phép thực hiện lại theo chính sách của doanh nghiệp.                                                       |
| **FR20** | **Lưu thông tin giao dịch**   | Hệ thống lưu trạng thái và thông tin cần thiết của giao dịch để phục vụ tra cứu và đối soát, không lưu thông tin nhạy cảm của phương thức thanh toán. |

5. Thông báo và đánh giá
| Mã       | Functional Requirement               | Diễn giải                                                               |
| -------- | ------------------------------------ | ----------------------------------------------------------------------- |
| **FR21** | **Gửi thông báo đặt xe**             | Hệ thống thông báo cho khách hàng khi yêu cầu đặt xe được tiếp nhận.    |
| **FR22** | **Gửi thông báo tài xế nhận chuyến** | Hệ thống thông báo cho khách hàng khi tài xế đã nhận chuyến.            |
| **FR23** | **Gửi thông báo trạng thái chuyến**  | Hệ thống gửi thông báo khi chuyến có thay đổi trạng thái quan trọng.    |
| **FR24** | **Gửi thông báo thanh toán**         | Hệ thống thông báo kết quả thanh toán cho khách hàng.                   |
| **FR25** | **Đánh giá tài xế**                  | Hệ thống cho phép khách hàng đánh giá tài xế sau khi chuyến hoàn thành. |


6. Quản lý người dùng và vận hành
| Mã       | Functional Requirement       | Diễn giải                                                                                          |
| -------- | ---------------------------- | -------------------------------------------------------------------------------------------------- |
| **FR26** | **Đăng ký và đăng nhập**     | Hệ thống cho phép khách hàng và tài xế đăng ký/đăng nhập và xác thực tài khoản.                    |
| **FR27** | **Quản lý hồ sơ khách hàng** | Hệ thống cho phép khách hàng xem và cập nhật thông tin cá nhân.                                    |
| **FR28** | **Quản lý hồ sơ tài xế**     | Hệ thống cho phép quản lý thông tin tài xế và trạng thái hoạt động.                                |
| **FR29** | **Quản lý phương tiện**      | Hệ thống cho phép quản lý thông tin phương tiện của tài xế.                                        |
| **FR30** | **Giám sát chuyến đi**       | Operator có thể xem danh sách và trạng thái các chuyến đang diễn ra.                               |
| **FR31** | **Xử lý chuyến bị lỗi**      | Operator có thể kiểm tra và hỗ trợ xử lý các trường hợp chuyến gặp sự cố.                          |
| **FR32** | **Quản lý phân quyền**       | Hệ thống kiểm soát quyền truy cập của nhân viên theo vai trò.                                      |
| **FR33** | **Xem báo cáo hoạt động**    | Hệ thống cung cấp số liệu về chuyến đi, doanh thu, tỷ lệ hoàn thành, tỷ lệ hủy và hiệu quả tài xế. |
| **FR34** | **Lưu lịch sử và Audit Log** | Hệ thống lưu lịch sử chuyến, giao dịch và các thao tác quan trọng phục vụ tra cứu và kiểm tra.     |



| Mã          | Business Rule                                           | Diễn giải                                                                                                          |
| ----------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **BRULE01** | Chỉ tài xế sẵn sàng mới được nhận chuyến                | Hệ thống chỉ gửi yêu cầu đặt xe đến tài xế đang ở trạng thái **Available/Ready**.                                  |
| **BRULE02** | Tài xế phải phù hợp với loại xe                         | Tài xế được đề xuất phải có phương tiện phù hợp với loại xe khách hàng đã lựa chọn.                                |
| **BRULE03** | Ưu tiên tài xế phù hợp và gần khách hàng                | Hệ thống ưu tiên tài xế dựa trên khoảng cách và các tiêu chí vận hành đã được doanh nghiệp xác định.               |
| **BRULE04** | Tài xế phải phản hồi trong thời gian quy định           | Tài xế phải chấp nhận hoặc từ chối chuyến trong khoảng thời gian do doanh nghiệp quy định.                         |
| **BRULE05** | Tài xế từ chối thì hệ thống tìm tài xế khác             | Khi tài xế từ chối, yêu cầu đặt xe không bị hủy mà tiếp tục được gửi đến tài xế phù hợp khác.                      |
| **BRULE06** | Tài xế không phản hồi thì chuyển sang tài xế khác       | Nếu hết thời gian phản hồi, hệ thống xem tài xế đó là không phản hồi và tiếp tục quá trình tìm kiếm.               |
| **BRULE07** | Không tìm được tài xế thì thông báo khách hàng          | Khi hệ thống không còn tài xế phù hợp, khách hàng phải nhận được thông báo rõ ràng.                                |
| **BRULE08** | Chỉ tính cước khi chuyến hoàn thành                     | Hệ thống xác định cước phải trả sau khi chuyến đi được cập nhật trạng thái hoàn thành.                             |
| **BRULE09** | Không lưu thông tin thanh toán nhạy cảm                 | Thông tin thẻ/tài khoản thanh toán nhạy cảm được xử lý bởi Payment Provider và không được lưu trực tiếp trong CAB. |
| **BRULE10** | Thanh toán thất bại phải được ghi nhận                  | Hệ thống phải ghi nhận giao dịch thất bại và thông báo cho khách hàng.                                             |
| **BRULE11** | Chỉ khách hàng đã hoàn thành chuyến mới được đánh giá   | Chức năng đánh giá chỉ được thực hiện sau khi chuyến đi hoàn thành.                                                |
| **BRULE12** | Chỉ người có quyền mới được thực hiện thao tác quản trị | Các chức năng nhạy cảm phải được giới hạn theo quyền của nhân viên vận hành.                                       |


2. Exception – Các trường hợp ngoại lệ



| Entity             | Thuộc tính chính                                                                                                                                                                                 | Mô tả                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| **Customer**       | `customer_id` (PK), `full_name`, `phone`, `email`, `password_hash`, `date_of_birth`, `status`, `created_at`                                                                                      | Lưu thông tin khách hàng                     |
| **Driver**         | `driver_id` (PK), `full_name`, `phone`, `email`, `password_hash`, `license_number`, `rating`, `status`, `current_latitude`, `current_longitude`, `created_at`                                    | Lưu thông tin tài xế và trạng thái hoạt động |
| **Vehicle**        | `vehicle_id` (PK), `driver_id` (FK), `vehicle_type_id` (FK), `license_plate`, `brand`, `model`, `color`, `status`                                                                                | Thông tin phương tiện của tài xế             |
| **VehicleType**    | `vehicle_type_id` (PK), `name`, `description`, `capacity`, `status`                                                                                                                              | Loại xe: Sedan, SUV, 4 chỗ, 7 chỗ...         |
| **Booking**        | `booking_id` (PK), `customer_id` (FK), `vehicle_type_id` (FK), `pickup_lat`, `pickup_lng`, `pickup_address`, `destination_lat`, `destination_lng`, `destination_address`, `status`, `created_at` | Yêu cầu đặt xe của khách hàng                |
| **Trip**           | `trip_id` (PK), `booking_id` (FK), `driver_id` (FK), `start_time`, `end_time`, `status`, `distance`, `duration`, `fare_amount`                                                                   | Chuyến đi thực tế sau khi có tài xế          |
| **DriverLocation** | `location_id` (PK), `driver_id` (FK), `latitude`, `longitude`, `recorded_at`                                                                                                                     | Lưu lịch sử vị trí tài xế                    |
| **Fare**           | `fare_id` (PK), `trip_id` (FK), `base_fare`, `distance_fare`, `time_fare`, `extra_fee`, `total_amount`, `calculated_at`                                                                          | Thông tin tính cước                          |
| **Payment**        | `payment_id` (PK), `trip_id` (FK), `payment_method`, `amount`, `status`, `transaction_id`, `paid_at`                                                                                             | Thông tin thanh toán                         |
| **Rating**         | `rating_id` (PK), `trip_id` (FK), `customer_id` (FK), `driver_id` (FK), `score`, `comment`, `created_at`                                                                                         | Đánh giá tài xế sau chuyến                   |
| **Notification**   | `notification_id` (PK), `user_id`, `type`, `title`, `content`, `status`, `created_at`                                                                                                            | Thông báo cho người dùng                     |
| **Admin/Operator** | `operator_id` (PK), `full_name`, `email`, `password_hash`, `role_id`, `status`                                                                                                                   | Nhân viên vận hành                           |
| **Role**           | `role_id` (PK), `role_name`, `description`                                                                                                                                                       | Vai trò và phân quyền                        |
| **AuditLog**       | `log_id` (PK), `operator_id` (FK), `action`, `entity_type`, `entity_id`, `created_at`                                                                                                            | Lưu vết thao tác quan trọng                  |


Xác định Non-Functional Requirements (NFR)

| Mã        | Nhóm                        | Non-Functional Requirement  | Diễn giải                                                                                                                                                       |
| --------- | --------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **NFR01** | **Performance**             | Thời gian phản hồi          | Các thao tác thông thường như đăng nhập, xem chuyến, cập nhật trạng thái nên phản hồi trong thời gian ngắn, ví dụ **≤ 2 giây** trong điều kiện tải bình thường. |
| **NFR02** | **Performance**             | Tìm tài xế nhanh            | Hệ thống phải có khả năng xử lý yêu cầu tìm tài xế nhanh để giảm thời gian khách hàng chờ xe.                                                                   |
| **NFR03** | **Scalability**             | Khả năng mở rộng            | Hệ thống phải có khả năng mở rộng khi số lượng khách hàng, tài xế và chuyến xe tăng mà không phải xây dựng lại toàn bộ hệ thống.                                |
| **NFR04** | **Availability**            | Tính sẵn sàng               | Hệ thống phải hoạt động ổn định và hạn chế downtime, đặc biệt trong thời gian nhu cầu đặt xe cao.                                                               |
| **NFR05** | **Reliability**             | Độ tin cậy                  | Lỗi của một thành phần như Payment hoặc Notification không được làm toàn bộ hệ thống đặt xe ngừng hoạt động.                                                    |
| **NFR06** | **Security**                | Xác thực người dùng         | Khách hàng, tài xế và nhân viên phải được xác thực trước khi truy cập các chức năng yêu cầu tài khoản.                                                          |
| **NFR07** | **Security**                | Phân quyền                  | Hệ thống phải kiểm soát quyền truy cập dựa trên vai trò, đặc biệt đối với các chức năng quản trị và dữ liệu nhạy cảm.                                           |
| **NFR08** | **Security**                | Bảo vệ dữ liệu              | Thông tin cá nhân, dữ liệu vị trí và dữ liệu giao dịch phải được bảo vệ khỏi truy cập trái phép.                                                                |
| **NFR09** | **Security**                | Bảo vệ thông tin thanh toán | CAB không được lưu trực tiếp thông tin nhạy cảm của thẻ/tài khoản thanh toán; việc xử lý phải thông qua Payment Provider.                                       |
| **NFR10** | **Auditability**            | Audit Log                   | Các thao tác quan trọng của nhân viên và hệ thống phải được lưu vết để phục vụ kiểm tra và điều tra sự cố.                                                      |
| **NFR11** | **Maintainability**         | Khả năng bảo trì            | Hệ thống phải được thiết kế theo các thành phần có trách nhiệm rõ ràng để dễ sửa lỗi và bảo trì.                                                                |
| **NFR12** | **Extensibility**           | Khả năng mở rộng chức năng  | Có thể bổ sung loại dịch vụ, phương thức thanh toán hoặc nhà cung cấp thông báo mà hạn chế ảnh hưởng đến các chức năng hiện tại.                                |
| **NFR13** | **Interoperability**        | Khả năng tích hợp           | Hệ thống phải có khả năng tích hợp với Payment Provider, Map/GPS Provider và Notification Provider.                                                             |
| **NFR14** | **Data Integrity**          | Tính toàn vẹn dữ liệu       | Dữ liệu Booking, Trip, Payment phải được đảm bảo nhất quán, đặc biệt khi xảy ra lỗi hoặc mất kết nối.                                                           |
| **NFR15** | **Availability/Resilience** | Khả năng phục hồi           | Hệ thống phải có cơ chế xử lý và phục hồi khi một dịch vụ thành phần gặp sự cố.                                                                                 |
| **NFR16** | **Privacy**                 | Bảo vệ dữ liệu cá nhân      | Việc truy cập và sử dụng thông tin cá nhân, vị trí và dữ liệu giao dịch phải tuân thủ chính sách bảo mật của doanh nghiệp và quy định pháp luật áp dụng.        |


Bước 11: Xác định Use Case (UC)

| Mã       | Use Case                   | Actor chính                |
| -------- | -------------------------- | -------------------------- |
| **UC01** | Đăng ký tài khoản          | Customer                   |
| **UC02** | Đăng nhập                  | Customer, Driver, Operator |
| **UC03** | Quản lý thông tin cá nhân  | Customer                   |
| **UC04** | Đặt xe                     | Customer                   |
| **UC05** | Xác định vị trí / điểm đón | Customer, Map/GPS          |
| **UC06** | Tìm tài xế phù hợp         | System                     |
| **UC07** | Nhận yêu cầu chuyến        | Driver                     |
| **UC08** | Chấp nhận chuyến           | Driver                     |
| **UC09** | Từ chối chuyến             | Driver                     |
| **UC10** | Theo dõi chuyến đi         | Customer                   |
| **UC11** | Cập nhật trạng thái chuyến | Driver                     |
| **UC12** | Cập nhật vị trí tài xế     | Driver                     |
| **UC13** | Tính cước                  | System                     |
| **UC14** | Thanh toán chuyến đi       | Customer, Payment Provider |
| **UC15** | Xử lý thanh toán thất bại  | Customer, Payment Provider |
| **UC16** | Nhận thông báo             | Customer, Driver           |
| **UC17** | Đánh giá tài xế            | Customer                   |
| **UC18** | Xem lịch sử chuyến đi      | Customer                   |
| **UC19** | Quản lý khách hàng         | Operator                   |
| **UC20** | Quản lý tài xế             | Operator                   |
| **UC21** | Quản lý phương tiện        | Operator                   |
| **UC22** | Giám sát chuyến đi         | Operator                   |
| **UC23** | Xử lý sự cố chuyến đi      | Operator                   |
| **UC24** | Tra cứu giao dịch          | Operator                   |
| **UC25** | Quản lý phân quyền         | Operator                   |
| **UC26** | Xem báo cáo hoạt động      | Operator                   |


Bước 12: Đặc tả Use Case (Use Case Specification)

| Thành phần                | Nội dung                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Use Case ID**           | UC01                                                                                                                                                                                                                                  |
| **Tên**                   | Đăng nhập                                                                                                                                                                                                                             |
| **Actor**                 | Customer, Driver, Operator                                                                                                                                                                                                            |
| **Mục tiêu**              | Cho phép người dùng xác thực để truy cập các chức năng của hệ thống                                                                                                                                                                   |
| **Pre-condition**         | Người dùng đã có tài khoản                                                                                                                                                                                                            |
| **Trigger**               | Người dùng nhập thông tin đăng nhập                                                                                                                                                                                                   |
| **Post-condition**        | Người dùng đăng nhập thành công và được cấp quyền tương ứng                                                                                                                                                                           |
| **Main Flow**             | 1. Người dùng nhập số điện thoại/email và mật khẩu. <br> 2. Hệ thống kiểm tra thông tin. <br> 3. Hệ thống xác thực tài khoản. <br> 4. Hệ thống tạo phiên đăng nhập. <br> 5. Người dùng được chuyển đến giao diện phù hợp với vai trò. |
| **Alternative/Exception** | Thông tin đăng nhập không chính xác → hệ thống thông báo lỗi. <br> Tài khoản bị khóa → từ chối đăng nhập và thông báo cho người dùng.                                                                                                 |

UC01 – Đăng nhập
| Thành phần                | Nội dung                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Use Case ID**           | UC01                                                                                                                                                                                                                                  |
| **Tên**                   | Đăng nhập                                                                                                                                                                                                                             |
| **Actor**                 | Customer, Driver, Operator                                                                                                                                                                                                            |
| **Mục tiêu**              | Cho phép người dùng xác thực để truy cập các chức năng của hệ thống                                                                                                                                                                   |
| **Pre-condition**         | Người dùng đã có tài khoản                                                                                                                                                                                                            |
| **Trigger**               | Người dùng nhập thông tin đăng nhập                                                                                                                                                                                                   |
| **Post-condition**        | Người dùng đăng nhập thành công và được cấp quyền tương ứng                                                                                                                                                                           |
| **Main Flow**             | 1. Người dùng nhập số điện thoại/email và mật khẩu. <br> 2. Hệ thống kiểm tra thông tin. <br> 3. Hệ thống xác thực tài khoản. <br> 4. Hệ thống tạo phiên đăng nhập. <br> 5. Người dùng được chuyển đến giao diện phù hợp với vai trò. |
| **Alternative/Exception** | Thông tin đăng nhập không chính xác → hệ thống thông báo lỗi. <br> Tài khoản bị khóa → từ chối đăng nhập và thông báo cho người dùng.                                                                                                 |

UC02 – Đặt xe
| Thành phần           | Nội dung                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Use Case ID**      | UC02                                                                                                                                                                                                                                             |
| **Tên**              | Đặt xe                                                                                                                                                                                                                                           |
| **Actor**            | Customer                                                                                                                                                                                                                                         |
| **Mục tiêu**         | Cho phép khách hàng tạo yêu cầu đặt xe                                                                                                                                                                                                           |
| **Pre-condition**    | Khách hàng đã đăng nhập                                                                                                                                                                                                                          |
| **Trigger**          | Khách hàng chọn chức năng "Đặt xe"                                                                                                                                                                                                               |
| **Post-condition**   | Yêu cầu đặt xe được tạo và chuyển sang quá trình tìm tài xế                                                                                                                                                                                      |
| **Main Flow**        | 1. Customer nhập/chọn điểm đón. <br> 2. Customer nhập điểm đến. <br> 3. Customer chọn loại xe. <br> 4. Hệ thống kiểm tra thông tin. <br> 5. Customer xác nhận đặt xe. <br> 6. Hệ thống tạo Booking. <br> 7. Hệ thống bắt đầu tìm tài xế phù hợp. |
| **Alternative Flow** | Customer thay đổi điểm đón/điểm đến trước khi xác nhận → hệ thống cập nhật thông tin.                                                                                                                                                            |
| **Exception**        | Điểm đón không hợp lệ → thông báo lỗi. <br> Không xác định được vị trí → yêu cầu Customer nhập địa chỉ thủ công. <br> Không có tài xế → thông báo không tìm được tài xế.                                                                         |
UC03 – Tìm tài xế phù hợp
| Thành phần           | Nội dung                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Use Case ID**      | UC03                                                                                                                                                                                                                                                                                                                                     |
| **Tên**              | Tìm tài xế phù hợp                                                                                                                                                                                                                                                                                                                       |
| **Actor**            | System                                                                                                                                                                                                                                                                                                                                   |
| **Supporting Actor** | Map/GPS Provider                                                                                                                                                                                                                                                                                                                         |
| **Mục tiêu**         | Tìm tài xế phù hợp nhất cho yêu cầu đặt xe                                                                                                                                                                                                                                                                                               |
| **Pre-condition**    | Booking đã được tạo                                                                                                                                                                                                                                                                                                                      |
| **Trigger**          | Hệ thống nhận yêu cầu tìm tài xế                                                                                                                                                                                                                                                                                                         |
| **Post-condition**   | Một tài xế được phân công hoặc hệ thống thông báo không tìm được tài xế                                                                                                                                                                                                                                                                  |
| **Main Flow**        | 1. Hệ thống lấy vị trí điểm đón. <br> 2. Tìm các tài xế đang sẵn sàng. <br> 3. Lọc theo loại xe. <br> 4. Tính khoảng cách từ tài xế đến điểm đón. <br> 5. Xếp hạng tài xế theo tiêu chí nghiệp vụ. <br> 6. Gửi yêu cầu cho tài xế phù hợp nhất. <br> 7. Chờ tài xế phản hồi. <br> 8. Nếu tài xế chấp nhận → xác nhận tài xế cho Booking. |
| **Alternative Flow** | Tài xế từ chối → hệ thống chọn tài xế tiếp theo. <br> Tài xế không phản hồi → hết thời gian → chọn tài xế tiếp theo.                                                                                                                                                                                                                     |
| **Exception**        | Không có tài xế phù hợp → cập nhật Booking thành `NO_DRIVER_FOUND` và thông báo Customer.                                                                                                                                                                                                                                                |

UC04 – Theo dõi chuyến đi
| Thành phần           | Nội dung                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Use Case ID**      | UC04                                                                                                                                                                                                                                             |
| **Tên**              | Theo dõi chuyến đi                                                                                                                                                                                                                               |
| **Actor**            | Customer                                                                                                                                                                                                                                         |
| **Supporting Actor** | Driver                                                                                                                                                                                                                                           |
| **Mục tiêu**         | Cho phép khách hàng theo dõi trạng thái chuyến                                                                                                                                                                                                   |
| **Pre-condition**    | Customer đã có Booking và tài xế đã nhận chuyến                                                                                                                                                                                                  |
| **Trigger**          | Customer mở thông tin chuyến                                                                                                                                                                                                                     |
| **Main Flow**        | 1. Hệ thống lấy thông tin chuyến. <br> 2. Hiển thị thông tin tài xế. <br> 3. Hiển thị thông tin phương tiện. <br> 4. Hiển thị trạng thái chuyến. <br> 5. Hiển thị vị trí tài xế. <br> 6. Cập nhật thông tin khi trạng thái hoặc vị trí thay đổi. |
| **Alternative Flow** | Không nhận được dữ liệu vị trí mới → hiển thị vị trí gần nhất và thông báo dữ liệu có thể chưa được cập nhật.                                                                                                                                    |
| **Post-condition**   | Customer luôn có thể xem trạng thái mới nhất mà hệ thống nhận được.                                                                                                                                                                              |
UC05 – Thực hiện chuyến đi
| Thành phần        | Nội dung                                                                                                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Use Case ID**   | UC05                                                                                                                                                                                                                                                                           |
| **Tên**           | Thực hiện chuyến đi                                                                                                                                                                                                                                                            |
| **Actor**         | Driver                                                                                                                                                                                                                                                                         |
| **Mục tiêu**      | Cho phép tài xế thực hiện và cập nhật trạng thái chuyến                                                                                                                                                                                                                        |
| **Pre-condition** | Driver đã nhận Booking                                                                                                                                                                                                                                                         |
| **Trigger**       | Driver bắt đầu thực hiện chuyến                                                                                                                                                                                                                                                |
| **Main Flow**     | 1. Driver nhận chuyến. <br> 2. Driver di chuyển đến điểm đón. <br> 3. Driver cập nhật "Đã đến". <br> 4. Driver đón khách. <br> 5. Driver cập nhật "Đã đón khách". <br> 6. Driver di chuyển đến điểm đến. <br> 7. Driver cập nhật "Hoàn thành". <br> 8. Hệ thống kết thúc Trip. |
| **Exception**     | Driver gặp sự cố → Operator có thể kiểm tra và hỗ trợ xử lý. <br> Driver mất kết nối → hệ thống tiếp tục duy trì chuyến và xử lý theo chính sách timeout.                                                                                                                      |

UC06 – Thanh toán chuyến đi
| Thành phần           | Nội dung                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Use Case ID**      | UC06                                                                                                                                                                                                                                                                                                                                      |
| **Tên**              | Thanh toán chuyến đi                                                                                                                                                                                                                                                                                                                      |
| **Actor**            | Customer                                                                                                                                                                                                                                                                                                                                  |
| **Supporting Actor** | Payment Provider                                                                                                                                                                                                                                                                                                                          |
| **Mục tiêu**         | Cho phép Customer thanh toán chi phí chuyến                                                                                                                                                                                                                                                                                               |
| **Pre-condition**    | Trip đã hoàn thành và hệ thống đã tính cước                                                                                                                                                                                                                                                                                               |
| **Trigger**          | Customer thực hiện thanh toán                                                                                                                                                                                                                                                                                                             |
| **Main Flow**        | 1. Hệ thống hiển thị số tiền phải trả. <br> 2. Customer chọn phương thức thanh toán. <br> 3. Nếu tiền mặt → hệ thống ghi nhận thanh toán. <br> 4. Nếu điện tử → hệ thống chuyển yêu cầu đến Payment Provider. <br> 5. Payment Provider trả kết quả. <br> 6. Hệ thống cập nhật trạng thái Payment. <br> 7. Thông báo kết quả cho Customer. |
| **Exception**        | Thanh toán điện tử thất bại → cập nhật `FAILED` → thông báo Customer → cho phép thanh toán lại theo chính sách.                                                                                                                                                                                                                           |
| **Post-condition**   | Payment được ghi nhận với trạng thái thành công hoặc thất bại.                                                                                                                                                                                                                                                                            |

UC07 – Đánh giá tài xế
| Thành phần        | Nội dung                                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Use Case ID**   | UC07                                                                                                                                                                 |
| **Tên**           | Đánh giá tài xế                                                                                                                                                      |
| **Actor**         | Customer                                                                                                                                                             |
| **Pre-condition** | Trip đã hoàn thành                                                                                                                                                   |
| **Trigger**       | Customer chọn chức năng đánh giá                                                                                                                                     |
| **Main Flow**     | 1. Customer chọn số điểm đánh giá. <br> 2. Nhập nhận xét nếu muốn. <br> 3. Hệ thống kiểm tra dữ liệu. <br> 4. Lưu Rating. <br> 5. Cập nhật điểm đánh giá của Driver. |
| **Exception**     | Customer đã đánh giá chuyến → không cho phép tạo đánh giá trùng.                                                                                                     |
UC08 – Giám sát chuyến đi
| Thành phần        | Nội dung                                                                                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Use Case ID**   | UC08                                                                                                                                                                                                                                           |
| **Tên**           | Giám sát chuyến đi                                                                                                                                                                                                                             |
| **Actor**         | Operator                                                                                                                                                                                                                                       |
| **Pre-condition** | Operator đã đăng nhập và có quyền                                                                                                                                                                                                              |
| **Trigger**       | Operator mở màn hình quản lý chuyến                                                                                                                                                                                                            |
| **Main Flow**     | 1. Hệ thống hiển thị danh sách chuyến. <br> 2. Operator lọc theo trạng thái. <br> 3. Operator chọn một chuyến. <br> 4. Hệ thống hiển thị thông tin Customer, Driver, Vehicle và Trip. <br> 5. Operator có thể kiểm tra và xử lý sự cố nếu cần. |
| **Exception**     | Operator không có quyền → hệ thống từ chối truy cập.                                                                                                                                                                                           |

| Mã       | Chức năng          | Acceptance Criteria                         |
| -------- | ------------------ | ------------------------------------------- |
| **AC01** | Đặt xe             | Booking được tạo khi thông tin hợp lệ       |
| **AC02** | Đặt xe             | Không tạo Booking khi thiếu thông tin       |
| **AC03** | Tìm tài xế         | Chỉ tìm tài xế Available                    |
| **AC04** | Tìm tài xế         | Lọc đúng loại xe                            |
| **AC05** | Tìm tài xế         | Ưu tiên theo tiêu chí nghiệp vụ             |
| **AC06** | Nhận chuyến        | Chấp nhận → gán tài xế                      |
| **AC07** | Từ chối            | Từ chối → tìm tài xế khác                   |
| **AC08** | Timeout            | Không phản hồi → tìm tài xế khác            |
| **AC09** | Không có tài xế    | Thông báo Customer và kết thúc tìm kiếm     |
| **AC10** | Theo dõi           | Customer thấy trạng thái chuyến             |
| **AC11** | Cash               | Ghi nhận thanh toán tiền mặt                |
| **AC12** | Electronic Payment | Thanh toán thành công được ghi nhận         |
| **AC13** | Payment Failed     | Thông báo và cho phép retry theo chính sách |
| **AC14** | Rating             | Customer đánh giá sau khi hoàn thành        |
| **AC15** | Operator           | Operator có quyền xem/giám sát chuyến       |

RTM cho CAB System
| RTM       | Business Goal | Business Requirement      | Functional Requirement                | Business Rule | Use Case          | Acceptance Criteria |
| --------- | ------------- | ------------------------- | ------------------------------------- | ------------- | ----------------- | ------------------- |
| **RTM01** | BG01          | BR01 – Đặt xe             | FR01 – Xác định vị trí KH             | RULE01        | UC02 – Đặt xe     | AC01                |
| **RTM02** | BG01          | BR01 – Đặt xe             | FR02 – Tìm tài xế sẵn có              | RULE01        | UC03 – Tìm tài xế | AC03                |
| **RTM03** | BG01          | BR02 – Tìm tài xế phù hợp | FR03 – Lọc theo loại xe               | RULE02        | UC03              | AC04                |
| **RTM04** | BG01          | BR02 – Tìm tài xế phù hợp | FR04 – Tính khoảng cách TX → điểm đón | RULE03        | UC03              | AC05                |
| **RTM05** | BG01          | BR02 – Tìm tài xế phù hợp | FR06 – Gửi yêu cầu cho TX             | RULE04        | UC03              | AC06                |
| **RTM06** | BG01          | BR02 – Tìm tài xế phù hợp | FR08 – Xử lý TX từ chối               | RULE05        | UC03              | AC07                |
| **RTM07** | BG01          | BR02 – Tìm tài xế phù hợp | FR09 – Xử lý TX không phản hồi        | RULE06        | UC03              | AC08                |
| **RTM08** | BG01          | BR02 – Tìm tài xế phù hợp | FR10 – Thông báo không tìm được TX    | RULE07        | UC03              | AC09                |
| **RTM09** | BG03          | BR03 – Theo dõi chuyến    | FR12 – Cập nhật trạng thái chuyến     | RULE08        | UC04              | AC10                |
| **RTM10** | BG03          | BR03 – Theo dõi chuyến    | FR13 – Cập nhật vị trí TX             | RULE03        | UC04              | AC10                |
| **RTM11** | BG04          | BR04 – Thanh toán         | FR16 – Tính cước                      | RULE08        | UC06              | AC11                |
| **RTM12** | BG04          | BR04 – Thanh toán         | FR17 – Thanh toán tiền mặt            | RULE09        | UC06              | AC11                |
| **RTM13** | BG04          | BR04 – Thanh toán         | FR18 – Thanh toán điện tử             | RULE09        | UC06              | AC12                |
| **RTM14** | BG04          | BR04 – Thanh toán         | FR19 – Xử lý thanh toán thất bại      | RULE10        | UC06              | AC13                |
| **RTM15** | BG03          | BR11 – Đánh giá tài xế    | FR25 – Đánh giá tài xế                | RULE11        | UC07              | AC14                |
| **RTM16** | BG02          | BR09 – Quản lý chuyến     | FR30 – Giám sát chuyến                | RULE12        | UC08              | AC15                |


```mermaid
flowchart TD
    A[Khách hàng tạo yêu cầu đặt xe] --> B[Hệ thống xác nhận yêu cầu]

    B --> C{Yêu cầu hợp lệ?}

    C -->|Không| D[Thông báo yêu cầu không hợp lệ]
    D --> Z[Kết thúc]

    C -->|Có| E[Hệ thống tìm tài xế phù hợp]

    E --> F{Có tài xế phù hợp?}

    F -->|Không| G[Thông báo không tìm được tài xế]
    G --> Z

    F -->|Có| H[Gửi yêu cầu đến tài xế]

    H --> I{Tài xế phản hồi?}

    I -->|Không phản hồi| J[Chờ hết thời gian phản hồi]
    J --> K[Tìm tài xế khác]

    K --> F

    I -->|Từ chối| L[Tài xế từ chối chuyến]
    L --> K

    I -->|Chấp nhận| M[Xác nhận tài xế cho chuyến]

    M --> N[Thông báo tài xế đã nhận chuyến cho khách hàng]

    N --> O[Tài xế di chuyển đến điểm đón]

    O --> P[Tài xế cập nhật đã đến điểm đón]

    P --> Q[Đón khách]

    Q --> R[Tài xế cập nhật đang thực hiện chuyến]

    R --> S[Hoàn thành chuyến]

    S --> T[Hệ thống tính cước]

    T --> U{Phương thức thanh toán}

    U -->|Tiền mặt| V[Khách hàng thanh toán cho tài xế]
    V --> W[Ghi nhận thanh toán]

    U -->|Điện tử| X[Gửi yêu cầu đến Payment Provider]
    X --> Y{Thanh toán thành công?}

    Y -->|Có| W
    Y -->|Không| AA[Thông báo thanh toán thất bại]
    AA --> AB[Xử lý thanh toán lại theo chính sách]
    AB --> X

    W --> AC[Khách hàng đánh giá tài xế]
    AC --> AD[Lưu lịch sử chuyến đi]
    AD --> AE[Kết thúc]



